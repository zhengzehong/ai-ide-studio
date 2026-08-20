# WebSocket RPC 协议

## PC HTTP Query API

PC 高频只读路径使用同源 HTTP，认证沿用 `x-ai-ide-token`。普通列表响应为 `{ data }`，分页响应为 `{ data, page: { hasMore, nextCursor } }`。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `GET /api/v1/tasks` | `projectId?`, `status?` | `{ data: TaskSummary[] }` | 任务摘要列表；不返回完整 `description`，只返回最多 240 字的 `descriptionPreview` |
| `GET /api/v1/sessions` | `projectId?`, `agentId?` | `{ data: Session[] }` | 会话列表，包含 `activity_state`；与 `sessions.list` 共用 Query Port |
| `GET /api/v1/sessions/:sessionId/messages` | `limit?`, `before?`, `includeToolCalls?`, `includeLatestToolCalls?` | `{ data: Message[], page }` | 消息历史；`limit` 为 1..200，`before` 使用消息时间游标 |
| `GET /api/v1/sessions/:sessionId/events` | `limit?`, `afterSequence?` | `{ data: SessionEvent[], page }` | 原始事件页；`limit` 为 1..1000，增量页按 sequence 升序且不跳页 |
| `GET /api/v1/sessions/:sessionId/recovery` | `limit?` | `{ data: { sessionId, latestSequence, events } }` | PC 轻量状态恢复；排除完整消息/思考/工具镜像事件，`latestSequence` 仍指向完整流游标 |
| `GET /api/v1/realtime-config` | — | `{ wsUrl, protocolVersion, legacyRpcEnabled, mode }` | 返回当前 Realtime 端点；PC/移动端在首次连接和每次重连前调用 |

成功响应带 `Cache-Control: no-store`、`Server-Timing` 和 `X-Response-Bytes`。PC 默认使用这些 HTTP 路由；`VITE_QUERY_TRANSPORT=ws`、移动端和 CLI 可继续使用下列 WS 兼容 RPC。兼容桥保持数组返回，不包含 HTTP 的 `page` 外壳。

## PC HTTP Command API

PC 高频 Session 命令使用 `POST /api/v1/commands`。认证沿用 `x-ai-ide-token`，请求必须包含 `Idempotency-Key`，JSON body 默认最大 16 MiB，并可通过 `SESSION_COMMAND_MAX_BYTES` 调整；body 的 `commandId` 用于结果关联，幂等键用于 Writer 账本去重。响应为 `{ data: { commandId, status, duplicate } }`。

| `type` | 必填字段 | HTTP 结果 | 说明 |
|--------|----------|-----------|------|
| `prompt` | `commandId`, `sessionId`, `clientMessageId`, `content` | `202 accepted` | 可选 `contextProjectId`, `images`；客户端提交前先订阅 Session |
| `session.cancel` | `commandId`, `sessionId` | `200 completed` | 等待 Runtime 把当前 turn 推进到终态；ACP cancel 超时后依次升级为关闭目标 Session、重启所属 Agent |
| `sessions.markRead` | `commandId`, `sessionId` | `200 completed` | 标记具体 Session 已读，不批量清项目 |
| `permission.respond` | `commandId`, `sessionId`, `permissionRequestId` | `200 completed` | 可选 `optionId`, `cancelled` |
| `elicitation.respond` | `commandId`, `sessionId`, `elicitationRequestId`, `action` | `200 completed` | `action` 为 accept/decline/cancel，可选结构化 `content` |

未知字段和未知 `type` 返回 400，超限返回 413，幂等键冲突返回 409，Command dispatcher 不可用返回 503。相同 Session 按 turn、interaction、cancel、read-state lane 分别串行，不同 lane 和不同 Session 可并行。PC 可用 `VITE_COMMAND_TRANSPORT=ws` 显式回滚；移动端和 Guest 保持兼容 WS 命令。

## 连接

客户端不得硬编码 WebSocket 端口或路径，必须使用 `GET /api/v1/realtime-config`。默认 Edge 模式返回当前公网 authority 的 `ws(s)://<host>:<port>/realtime`，HTTP 与 WebSocket 只需发布同一个公网端口，内部 Realtime 端口不会暴露。`EDGE_MODE=disabled` 直连回滚时 discovery 可以返回独立 Realtime 地址。Owner token 通过 `token` query 传给 WebSocket，分享页使用 `shareToken`。

## 消息格式

所有消息为 JSON 对象，包含 `type` 字段。请求消息包含 `requestId`，响应消息用相同 `requestId` 回复。

## 订阅

Realtime 只向订阅目标发送 Session 事件，全局元数据事件按认证范围广播。

| 控制消息 | 参数 | 返回 | 说明 |
|----------|------|------|------|
| `subscribe` | `{ requestId?, sessionIds }` | `result` | 增加 Session 订阅；guest 只能订阅分享会话 |
| `unsubscribe` | `{ requestId?, sessionIds }` | `result` | 删除 Session 订阅 |
| `ping` | `{ timestamp? }` | `pong` | Realtime 进程本地处理，不进入 API 事件循环；PC 每 15 秒发送，30 秒无任何入站帧时主动重连 |
| `resume` | `{ cursors }` | `resume:ack` | 重连后提交客户端游标并恢复订阅流 |

带游标的实时消息可包含 `streamGeneration` 与 `sequence`。generation 改变、sequence 跳号、单连接发送队列溢出或 socket 缓冲超过限制时，服务端发送 `{ type: "resync_required", sessionId?, reason }`；客户端先发送 resync acknowledgement 解除增量屏障，再通过 HTTP Query 读取最新 snapshot。服务端允许关键 `session:done` 排在 `resync_required` 之后送达，权限请求、提问和错误同样不会静默丢弃。

Runtime 可见 patch 不经过 API 事件总线，而是通过 Runtime→Realtime 认证本机管道直接进入同一个订阅分发器。该路径只接受服务内部 token 和长度前缀 Protobuf envelope；浏览器协议仍然是 JSON `session:update`。Runtime 只在发布可见 patch 时分配 `streamGeneration + sequence`，持久化复用同一 patch 的游标；Realtime 只验证和转发，不重新编号。

`session:done` 不走 Runtime 直连流。Runtime 先 flush 可见与持久化更新，再向 API 发 done barrier；API 等 Writer 提交 `message.done` 与 Outbox 后，通过 `session:committed_done` 发布带终止游标的 `session:done`。因此客户端看到 done 时，同 Session 的前序 patch 已完成持久化，HTTP snapshot 可立即读取。

`REALTIME_LEGACY_RPC=enabled` 时，下面尚未迁移的领域 RPC 通过本地 Protobuf IPC 转发到 API，`requestId` 和订阅变更保持兼容；设为 `disabled` 后，非控制消息返回明确错误。该兼容桥不改变 Realtime 无 DB/Core 依赖的边界。

## RPC 方法

### 文件资源

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `fs.list` | `{ projectId, dirPath? }` | `FileEntry[]` | 读取项目文件树；相对路径受项目根目录限制 |
| `fs.read` | `{ projectId, filePath }` | `FileContent` | 按需读取文本或返回媒体元数据；显式绝对路径沿用服务端特权读取能力 |
| `fs.assetUrl` | `{ projectId, filePath, basePath?, mode? }` | `{ url, expiresAt, path, kind }` | 仅 owner；解析 Markdown 相对/绝对资源并签发一小时资源地址，`mode` 为 `inline` 或 `attachment` |

`GET /api/fs/asset` 接受签名地址中的 `projectId/path/mode/expires/signature`，也兼容旧客户端的长期 token。媒体响应声明 `Accept-Ranges: bytes`，单段 Range 返回 `206 + Content-Range`，非法或多段 Range 返回 `416`。签名过期只使当前 URL 失效，文件卡片保留原路径，重新打开或播放器重试时会再次调用 `fs.assetUrl`。

### Agent 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `agents.list` | `{ projectId? }` | `Agent[]` | 列出 Agent，可按项目过滤 |
| `agents.create` | `{ type, name, runtime, config? }` | `Agent` | 创建全局/兼容 Agent；项目工作台优先使用模板部署或自定义项目 Agent |
| `agents.reorder` | `{ projectId, agentIds }` | `Agent[]` | 保存当前项目内 Agent 自定义排序；传入 ID 必须全部属于该项目 |

### 全局助理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `globalAssistant.get` | `{}` | `{ assistant, agent, session } \| null` | 获取当前全局助理绑定 |
| `globalAssistant.setTemplate` | `{ templateId, name?, runtime?, systemPrompt?, modelProfileId? }` | `{ assistant, agent, session }` | 从 Agent 模板设置唯一全局助理，并创建或复用普通 Agent/Session；`modelProfileId` 为空值时清除绑定 |
| `globalAssistant.touch` | `{}` | `{ assistant, agent, session } \| null` | 更新全局助理最近使用时间并返回当前绑定 |

### 全局会话坞

全部 Session Dock RPC 仅允许 owner 连接调用。会话坞是“置顶会话”的持久化后端，只保存跨项目入口和顺序，不读取消息正文，也不改变 Workspace 内的 Agent/Session 排序；PC 页签、PC 快捷抽屉和移动端第一个 Tab 共享这份清单。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sessionDock.list` | `{}` | `SessionDockItem[]` | 按固定顺序返回普通项目会话的轻量状态；自动排除自主、模板、归档、删除和无项目会话 |
| `sessionDock.search` | `{ query?, limit? }` | `SessionDockItem[]` | 跨项目搜索尚未固定的普通会话；匹配项目、Agent 或会话标题，`limit` 限制为 1..50 |
| `sessionDock.add` | `{ sessionId }` | `SessionDockItem` | 将可固定会话加入全局会话坞；重复调用幂等 |
| `sessionDock.remove` | `{ sessionId }` | `{ removed }` | 从全局会话坞移除会话，不删除 Session |
| `sessionDock.reorder` | `{ sessionIds }` | `SessionDockItem[]` | 原子保存全部固定会话的顺序；ID 必须完整且不重复 |

### Session 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sessions.list` | `{ agentId?, projectId? }` | `Session[]` | 列出 Session；PC 已迁移 HTTP，当前为移动端/CLI/回滚兼容桥 |
| `sessions.projectStats` | `{}` | `{ generatedAt, items: { projectId, sessionCount, runningCount, unreadCount }[] }` | 返回全部项目 active 会话的总数、运行中和未读统计快照；排除删除、归档和模板会话，未读只统计非运行中且 `last_message_at > last_read_at` 的会话，空项目返回 0 |
| `sessions.create` | `{ agentId, taskId?, projectId? }` | `Session` | 只创建本地 SQLite Session；不启动 ACP runtime，也不创建 ACP session |
| `sessions.copy` | `{ sessionId }` | `Session` | 复制会话：先通过 ACP fork 复制 runtime 上下文，再复制 SQLite 中最近 10 条消息及相关 `session_events` |
| `sessions.listLocalImportCandidates` | `{ agentId, projectId? }` | `LocalSessionCandidate[]` | 扫描当前机器上的 Codex / Claude Code JSONL 本地会话候选，按 Agent runtime 和项目工作目录排序 |
| `sessions.importLocal` | `{ agentId, projectId?, jsonlPath? }` 或 `{ agentId, projectId?, externalSessionId, sourcePath?, runtime?, cwd?, title? }` | `{ session, warning, candidate }` | 绑定本地 Codex / Claude Code 原生会话 id，创建一个空平台 Session，不导入历史消息或事件 |
| `sessions.rename` | `{ sessionId, title }` | `Session` | 重命名 Session |
| `sessions.close` | `{ sessionId }` | `Session` | 关闭 ACP 会话并标记为 closed |
| `sessions.archive` | `{ sessionId }` | `Session` | 归档 Session |
| `sessions.delete` | `{ sessionId }` | `{ deleted: true }` | 软删除 Session，默认列表不再返回 |
| `sessions.reorder` | `{ projectId, agentId, sessionIds }` | `Session[]` | 保存同一项目、同一 Agent 下的 Session 自定义排序 |
| `session.getModels` | `{ sessionId }` | `SessionCapabilities` | 获取模型/模式/配置选项 |
| `session.setModel` | `{ sessionId, modelId }` | `void` | 切换模型；成功后写入 `sessions.runtime_preferences_json.modelId` |
| `session.setMode` | `{ sessionId, modeId }` | `void` | 切换模式；成功后写入 `sessions.runtime_preferences_json.modeId` |
| `session.setConfig` | `{ sessionId, configId, value }` | `void` | 切换配置；成功后写入 `sessions.runtime_preferences_json.config[configId]` |
| `session.cancel` | `{ sessionId }` | `{ ok: true }` | HTTP Command 的 WS 兼容入口；使用相同的 Runtime 终态取消和升级策略 |
| `session.fork` | `{ sessionId }` | `Session` | Fork 会话 |
| `sessions.messages` | `{ sessionId, limit?, before?, includeToolCalls? }` | `Message[]` | HTTP Query Port 的 WS 兼容桥；默认不返回完整历史工具 JSON，只返回 `has_tool_calls` / `tool_call_count`，并返回 ACP diff 文件变更轻量摘要 `file_changes_json` / `has_file_changes` / `file_change_count` |
| `sessions.messageToolCalls` | `{ sessionId, messageId }` | `ToolCallSummary[]` | 懒加载单条消息的工具调用摘要 |
| `sessions.messageToolCallDetail` | `{ sessionId, messageId, toolCallId }` | `ToolCallDetail` | 懒加载单个工具调用详情，长输出会截断 |
| `sessions.messageFileChanges` | `{ sessionId, messageId }` | `FileChangeDetail` | 懒加载单条 Agent 消息的 ACP diff 文件变更详情 |
| `sessions.messageProcess` | `{ sessionId, messageId }` | `TurnProcessItem[]` | 懒加载单条 Agent 消息的执行过程轻量列表；按 `sequence` 升序返回，默认不返回大 `detail_json` |
| `sessions.processItemDetail` | `{ sessionId, messageId, itemId }` | `TurnProcessItem` | 懒加载单个执行过程块详情，例如工具 raw 输出、权限详情、计划详情或完整 diff |
| `sessions.messageEvents` | `{ sessionId, messageId }` | `SessionEvent[]` | 兼容旧数据的执行过程事件兜底恢复；新数据优先使用 `sessions.messageProcess` |
| `sessions.events` | `{ sessionId, limit?, afterSequence? }` | `SessionEvent[]` | HTTP Query Port 的恢复事件 WS 兼容桥 |
| `prompt` | `{ sessionId, content, clientMessageId?, contextProjectId?, images? }` | `{ status }` | 发送消息；`clientMessageId` 用于让前端乐观用户消息与 SQLite 持久化消息合并；`contextProjectId` 用于全局助理等无项目 Session 的本轮项目工具上下文，不写入 Session；首次发送时懒启动 runtime，并按需 new/resume ACP session |
| `permission.respond` | `{ sessionId, permissionRequestId, optionId?, cancelled? }` | `void` | 响应权限请求 |
| `elicitation.respond` | `{ sessionId, elicitationRequestId, action, content? }` | `void` | 响应提问请求 |
| `decision` | `{ sessionId, messageId, choice }` | `void` | 响应决定 |

### 自主 Agent

全部 autonomy RPC 仅允许 owner 连接调用，分享访客在读取状态前即被拒绝。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `autonomy.list` | `{ projectId }` | `AgentAutonomyState[]` | 列出项目 Agent 的轻量自主状态；不批量返回 memory.md 正文 |
| `autonomy.get` | `{ projectId, agentId }` | `AgentAutonomyState` | 获取单个 Agent 的完整自主状态、固定 Session 和 memory.md 预览 |
| `autonomy.enable` | `{ projectId, agentId }` | `AgentAutonomyState` | 创建或复用固定自主 Session，严格确认 Runtime 特权模式后启用 10 分钟心跳 |
| `autonomy.disable` | `{ projectId, agentId }` | `AgentAutonomyState` | 停用心跳；正在运行的自主 Prompt 会请求取消 |
| `autonomy.update` | `{ projectId, agentId, prompt?, interests? }` | `AgentAutonomyState` | 更新独立自主提示词或关注方向；提示词变化会重建该 Session 的 ACP 上下文 |
| `autonomy.interest.add` | `{ projectId, agentId, text }` | `AgentAutonomyState` | 添加一条关注方向 |
| `autonomy.interest.remove` | `{ projectId, agentId, interestId }` | `AgentAutonomyState` | 删除一条关注方向 |
| `autonomy.runNow` | `{ projectId, agentId }` | `{ accepted, sessionId }` | 异步发起一次强制检查，RPC 不等待模型执行完成 |
| `autonomy.reports.list` | `{ projectId, agentId?, before?, limit? }` | `AutonomyReport[]` | 按时间倒序读取 Markdown 汇报 |

### Task 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `tasks.list` | `{ status?, projectId? }` | `TaskSummary[]` | 列出任务摘要，可按项目过滤；完整正文通过 `tasks.get` 按需读取 |
| `tasks.get` | `{ taskId }` | `Task & { sessions, steps, stepProgress }` | 读取单个任务完整详情，包括完整 `description` |
| `tasks.create` | `{ title, description, projectId? }` | `Task` | 创建协作任务空壳；任务为 `draft`，不建步骤、不分派 Agent。旧调用方的分派兼容逻辑仅保留在后端 RPC 入口，不作为新 UI 协议使用 |
| `tasks.createSimple` | `{ title, description, assignee, projectId?, sessionId? }` | `Task & { defaultStepId, sessionId, steps, stepProgress }` | 创建简单任务：自动创建一个默认 step，分派给 `assignee` 并立即派发；`selfExecute=true` 的 Agent 入口只跳过默认 step 的初始 prompt |
| `tasks.update` | `{ taskId, status?, stage? }` | `Task` | 更新任务状态 |
| `tasks.start` | `{ taskId }` | `{ taskId, status, dispatched, steps, stepProgress }` | 启动协作任务，派发 ready step |
| `tasks.step.add` | `{ taskId, title, description?, assignee?, sessionId?, dependsOn? }` | `{ taskId, step, reverted, taskStatus, steps, stepProgress }` | 添加步骤；运行中任务变更步骤会回退到 `draft` |
| `tasks.step.update` | `{ taskId, stepId, title?, description?, assignee?, sessionId?, dependsOn? }` | `{ taskId, step, reverted, taskStatus, steps, stepProgress }` | 更新步骤；运行中任务变更步骤会回退到 `draft` |
| `tasks.step.remove` | `{ taskId, stepId }` | `{ taskId, stepId, removed, reverted, taskStatus, steps, stepProgress }` | 删除步骤；运行中任务变更步骤会回退到 `draft` |

### 事件中心

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `eventCategories.list` | `{ projectId? }` | `EventCategory[]` | 列出事件类别；传入项目时返回全局类别 + 项目类别，同名项目类别覆盖全局类别 |
| `eventCategories.create` | `{ projectId?, categoryId, name, description?, schema?, defaultPriority?, allowedWriters?, allowedConsumers?, enabled? }` | `EventCategory` | 创建事件类别；传入 `projectId` 时创建项目类别，不传时创建全局类别 |
| `eventCategories.update` | `{ projectId?, categoryId, ...fields }` | `EventCategory` | 更新同一作用域内的事件类别 |
| `eventCategories.toggle` | `{ projectId?, categoryId, enabled }` | `EventCategory` | 启用或停用同一作用域内的事件类别 |
| `eventCategories.delete` | `{ projectId?, categoryId }` | `{ categoryId, deleted }` | 删除同一作用域内未被事件或订阅引用的事件类别；已有引用时应停用而不是删除 |
| `events.list` | `{ projectId?, categoryId?, status?, keyword?, limit?, offset? }` | `EventCenterEvent[]` 或 `{ items, total, limit, offset }` | 查询事件；传入 `limit`、`offset` 或 `keyword` 时返回分页结果 |
| `events.get` | `{ eventId }` | `EventCenterEvent & { consumptions }` | 获取事件详情和消费记录 |
| `events.create` | `{ projectId?, categoryId, title, summary?, sourceType?, sourceId?, sourceLabel?, priority?, confidence?, tags?, payload?, evidence?, dedupeKey?, createdByAgentId? }` | `EventCenterEvent` | 写入事件 |
| `events.ignore` | `{ eventId }` | `EventCenterEvent` | 忽略事件 |
| `events.archive` | `{ eventId }` | `EventCenterEvent` | 归档事件 |
| `events.reopen` | `{ eventId }` | `EventCenterEvent` | 重新打开事件 |
| `events.convertToTask` | `{ eventId, title?, description?, assignAgentId?, projectId? }` | `Task` | 将事件转成普通任务并写入关联 |
| `eventSubscriptions.list` | `{ projectId? }` | `EventSubscription[]` | 查询订阅规则 |
| `eventSubscriptions.create` | `{ projectId?, name, categoryId, consumerAgentId?, consumerLabel?, actionMode?, filter?, enabled?, autoStart?, consumerSessionMode?, consumerSessionId? }` | `EventSubscription` | 创建订阅规则；`consumerSessionMode` 支持 `existing` / `new_each` / `new_fixed` |
| `eventSubscriptions.update` | `{ subscriptionId, projectId?, name, categoryId, consumerAgentId?, consumerLabel?, actionMode?, filter?, enabled?, autoStart?, consumerSessionMode?, consumerSessionId? }` | `EventSubscription` | 更新订阅规则；仅影响后续匹配，不回写历史消费记录 |
| `eventSubscriptions.toggle` | `{ subscriptionId, enabled }` | `EventSubscription` | 启用或停用订阅规则 |
| `eventSubscriptions.delete` | `{ subscriptionId }` | `{ subscriptionId, deleted }` | 删除订阅规则；历史消费记录保留 |
| `eventConsumptions.claimNext` | `{ projectId?, agentId }` | `{ event, consumption } \| null` | 消费 Agent 领取下一条待消费事件 |
| `eventConsumptions.run` | `{ consumptionId, sessionId? }` | `{ event, consumption, sessionId }` | 从 UI 手动启动指定消费记录的消费者 Agent 会话；传入 `sessionId` 时优先复用该会话 |
| `eventConsumptions.consume` | `{ consumptionId, resultSummary?, result?, error? }` | `EventConsumption` | 提交消费结果 |

### Team 上下文

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `teams.current` | `{ sessionId }` | `{ team, currentMember, members, tasks, mailbox }` | 按当前普通会话反查 Team 上下文；非 Team 会话返回空上下文。Team 不是独立页面，Leader 和成员都通过各自 `session_id` 复用会话页。 |

### 知识库

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `knowledgeBases.list` | `{ projectId }` | `{ knowledgeBases }` | 列出项目可见知识库：项目库 + 已挂载 shared 库；缺失项目库时会懒创建 |
| `knowledgeBases.shared` | `{}` | `{ knowledgeBases }` | 列出所有 shared 知识库，供项目挂载 |
| `knowledgeBases.create` | `{ projectId, name, kind, src, icon?, description?, note? }` | `{ kb }` | 创建 project/shared 知识库；project 库受每项目唯一约束 |
| `knowledgeBases.mount` | `{ projectId, kbId, note? }` | `{ mount }` | 将 shared 知识库挂载到项目 |
| `knowledgeBases.unmount` | `{ projectId, kbId, note? }` | `{ ok: true }` | 卸载 shared 知识库，不删除内容 |
| `knowledgePages.list` | `{ projectId, kbId }` | `{ pages }` | 列出知识库页面，并在 code 页面源文件变化时懒标记 stale |
| `knowledgePages.read` | `{ projectId, pageId?，kbId?, title? }` | `{ kb, page, outLinks, backlinks }` | 读取页面正文、wikilink 出链和反向链接 |
| `knowledgePages.search` | `{ projectId, query, kbIds?, limit? }` | `{ pages }` | 在可见知识库内用 SQL LIKE 搜索 |
| `knowledgePages.create` | `{ projectId, kbId, title, section?, summary?, body, tags?, srcFiles?, note? }` | `{ page, activity, warnings }` | 人工创建页面并写 activity |
| `knowledgePages.update` | `{ projectId, pageId, title?, section?, summary?, body, tags?, note? }` | `{ page, activity }` | 人工编辑页面并写 activity |
| `knowledgePages.refreshFromCode` | `{ projectId, pageId, body, srcFiles?, confirmOverwriteHumanEdit?, note? }` | `{ page, activity }` | 显式刷新 code 页面；人工编辑过的页面需要确认 |
| `knowledgeActivities.list` | `{ projectId, kbId? }` | `{ activities }` | 列出当前项目可见知识库活动 |
| `knowledgeActivities.revert` | `{ projectId, activityId, note? }` | `{ page?, activity }` | 按 activity 快照撤销写入 |

### Rule 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `rules.list` | — | `Rule[]` | 列出所有规则 |
| `rules.create` | `{ name, cron, action, actionConfig }` | `Rule` | 创建规则；`actionConfig.session_mode/session_id` 支持定时任务或定时 Prompt 的 `existing` / `new_each` / `new_fixed` 会话策略 |
| `rules.update` | `{ ruleId, enabled?, ... }` | `Rule` | 更新规则 |
| `rules.delete` | `{ ruleId }` | `void` | 删除规则 |

### 模型管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `models.list` | — | `ModelProvider[]` | 列出模型供应商 |
| `models.create` | `{ name, displayName, protocol, baseUrl, apiKey, models?, isDefault? }` | `ModelProvider` | 创建供应商；`protocol` 支持 `openai`、`claude`、`new-api` |
| `models.update` | `{ providerId, ...fields }` | `ModelProvider` | 更新供应商配置 |
| `models.toggle` | `{ providerId, enabled }` | `{ ok: true }` | 启用或停用供应商 |
| `models.delete` | `{ providerId }` | `{ ok: true }` | 删除供应商 |
| `models.setDefault` | `{ providerId }` | `{ ok: true }` | 设置默认供应商 |
| `models.test` | `{ providerId }` | `{ ok, models?, error? }` | 测试供应商并拉取 `/v1/models` 列表 |
| `modelProfiles.list` | `{ runtime?, enabledOnly? }` | `ModelProfile[]` | 列出模型档案，可按 runtime 过滤 |
| `modelProfiles.global.get` | `{ runtime }` | `{ runtime, enabled, profileId?, profile? }` | 读取 Claude Code 或 Codex 全局模型档案 |
| `modelProfiles.global.set` | `{ runtime, profileId }` | `{ runtime, enabled, profileId, profile }` | 设置 Runtime 全局模型档案；下一轮请求惰性生效 |
| `modelProfiles.global.clear` | `{ runtime }` | `{ runtime, enabled:false }` | 清除 Runtime 全局模型档案，恢复 Agent/系统配置 |
| `modelProfiles.create` | `{ name, runtime, providerId, contextWindow?, config }` | `ModelProfile` | 创建 Claude Code 或 Codex 模型档案 |
| `modelProfiles.update` | `{ profileId, ...fields }` | `ModelProfile` | 更新模型档案 |
| `modelProfiles.toggle` | `{ profileId, enabled }` | `{ ok: true }` | 启用或停用模型档案 |
| `modelProfiles.setDefault` | `{ profileId }` | `ModelProfile` | 将启用中的模型档案设为该 runtime 的默认档案 |
| `modelProfiles.delete` | `{ profileId }` | `{ ok: true }` | 删除模型档案，并清理 Agent 上的对应绑定 |

### Tool / MCP 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `tools.list` | — | `{ tools, bindings }` | 列出工具定义和绑定关系 |
| `tools.get` | `{ toolId }` | `{ tool, bindings }` | 获取单个工具及其绑定 |
| `tools.create` | `{ name, displayName, description, category, toolType, config, inputSchema?, permissions?, defaultScope?, targetId? }` | `Tool` | 注册工具；可选创建默认绑定 |
| `tools.update` | `{ toolId, displayName?, description?, category?, toolType?, config?, inputSchema?, permissions? }` | `Tool` | 更新工具配置 |
| `tools.toggle` | `{ toolId, enabled }` | `{ ok: true }` | 启用或停用工具 |
| `tools.delete` | `{ toolId }` | `{ ok: true }` | 删除非内置工具 |
| `tool-bindings.set` | `{ toolId, scope, targetId?, configOverride?, enabled? }` | `ToolBinding` | 设置方法级可见性；`enabled=false` 表示对该 scope/target 显式隐藏 |
| `tool-bindings.remove` | `{ toolId, scope, targetId? }` | `{ ok: true }` | 删除工具绑定 |
| `tool-profiles.list` | — | `{ profiles }` | 列出内置工具权限模板 |
| `tool-profiles.apply` | `{ profileId, agentId }` | `{ profile, agentId, boundToolNames, missingToolNames }` | 将权限模板写入指定 Agent 的工具绑定 |

## 事件广播

`autonomy:update` 是全局元数据事件，载荷为 `{ agentId, projectId }`。启停、关注点、排班、汇报、tick 开始/跳过/失败时都会发布；客户端收到后按项目重新读取自主状态。Session 实时消息仍走原有订阅事件，不复制到 `autonomy:update`。

项目秘书 RPC 使用当前项目 `projectId` 做边界校验：`secretary.list/get/create/update/delete` 管理秘书，`secretary.runNow` 创建一次持久化运行请求，`secretary.runs.list` 读取不含内部 payload 的轻量执行历史，`secretary.threads.list/thread.get/thread.markRead/thread.archive` 管理邮箱 Thread。`secretary.session.get` 只允许定向读取该秘书自己的隐藏运行/对话 Session，供 PC/APP 深链到现有会话工作区；普通 `sessions.list` 继续排除这两类 Session。`secretary:update` 载荷为 `{ projectId }`，表示配置、运行状态或邮箱发生变化，客户端按项目重新读取秘书、运行历史和 Thread。

服务端主动推送的事件类型：

| 事件 | 数据 | 说明 |
|------|------|------|
| `session:update` | `{ sessionId, agentId, data }` | 流式会话更新，包含消息、工具、权限、提问、计划和 `lifecycle.*` 阶段 |
| `session:process_item` | `{ sessionId, agentId?, item }` | 当前轮执行过程块的轻量增量；用于实时展示思考、工具、权限、提问、计划、文件修改等过程 |
| `session:event` | `{ sessionId, agentId?, event }` | 持久化事件 |
| `session:done` | `{ sessionId, agentId, messageId, turnId?, stopReason, turnUsage? }` | Agent 回复完成；取消沿用原 turn 的 `messageId`/`turnId` 且只发布一次，`stopReason` 可为 `cancelled` |
| `session:activity` | `{ sessionId, agentId, turnId?, state, reason, timestamp }` | 全局轻量事件：`running` 表示会话开始执行，`idle` 表示会话执行结束；用于左侧会话列表活动/未读提示，不承载聊天内容；`turnId` 仅用于诊断 |
| `session:capabilities` | `{ sessionId, capabilities }` | 会话能力信息 |
| `session:changed` | `{ sessionId, data }` | Session 标题、状态、归档/删除等列表元数据变更；已读确认统一使用 `data.last_read_at`，不发送 camelCase 别名 |
| `session-dock:update` | `{ action, sessionId? }` | 全局会话坞增加、移除或排序变化；客户端收到后重新读取轻量列表 |
| `agent:status` | `{ agentId, status }` | Agent 在线状态 |
| `task:update` | `{ taskId, data }` | Task 状态变更 |
| `event-center:update` | `{ eventId?, categoryId?, subscriptionId?, consumptionId?, taskId?, sessionId?, event }` | 事件中心类别、事件、订阅或消费记录变化 |
| `team:update` | `{ teamId, sessionIds, data }` | Team 成员、任务或 mailbox 变化；前端仅在当前 `sessionId` 属于 `sessionIds` 时刷新 `teams.current`。 |
| `knowledge-base:update` | `{ projectId?, kbId?, pageId?, event }` | 知识库、页面、挂载或 activity 变化；前端据此刷新当前项目知识库视图 |
| `rule:update` | `{ ruleId, data }` | Rule 状态变更 |

Team 运行时事件：`team.member.spawn` 会广播包含新成员 Session 行的 `session:changed`。`team.member.message` 携带 `taskId` 时，会把 `backlog/planning` 的 Team Task 更新为 `executing`，再广播 `task:update` 与 `team:update`。工作台在当前 Team 匹配 `team:update` 时应刷新项目 agents/sessions/tasks。

## 类型定义

完整 TypeScript 类型定义见 `src/types/ws-protocol.ts`。

## 项目级约定

- 项目级能力（工作台、任务、自动化、文件浏览）必须携带 `projectId`。
- `projectId` 缺失时，只允许访问全局页（概览、Agent 广场、设置）。
- `session.getModels` 返回的 capabilities 由 ACP host 合并模型、模式、配置、命令等能力后上报。
- `session.setModel`、`session.setMode`、`session.setConfig` 会懒连接 ACP session；保存的 runtime preferences 会在后续 `newSession`、`resumeSession`、`loadSession` 或 fork 后重新应用。
- Session 删除使用软删除：`sessions.delete` 写入 `deleted_at`，保留 `messages` 和 `session_events` 历史数据；`sessions.list` 默认过滤已删除记录。




### ACP lifecycle events

当 `session:update.data.eventType` 以 `lifecycle.` 开头时，表示 runtime/session 生命周期进度。后端会把同名类型持久化到 `session_events.type`。

| eventType | 说明 |
|------|------|
| `lifecycle.prompt_received` | 后端已收到用户消息 |
| `lifecycle.runtime_starting` | 正在启动 Codex/Claude ACP runtime |
| `lifecycle.runtime_ready` | ACP runtime 已初始化 |
| `lifecycle.session_creating` | 正在创建新的 ACP session |
| `lifecycle.session_resuming` | 正在恢复已有 ACP session / Codex thread |
| `lifecycle.session_ready` | ACP session 已连接 |
| `lifecycle.prompt_sent` | 消息已发送给 Agent，等待流式输出 |
| `lifecycle.session_disconnected` | 空闲回收断开 runtime 侧 ACP session；保留 SQLite `sessions.acp_session_id` |
| `lifecycle.failed` | runtime/session/prompt 阶段失败 |

`session.setModel`、`session.setMode`、`session.setConfig` 如果发现当前 session 尚未连接，会先懒连接 ACP session。

## 项目 Agent RPC

项目 Agent RPC 用于把全局 Agent 模板部署到具体项目，或在项目内创建自定义 Agent。项目级 Session、Task、文件浏览和 MCP 工具上下文都应使用同一个 `projectId`。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `agents.deployTemplate` | `{ projectId, templateId, name?, runtime?, systemPrompt?, icon?, modelProfileId?, modelProfileMode? }` | `Agent` | 将全局模板部署为项目级 Agent；未指定档案时默认跟随全局 |
| `agents.createCustom` | `{ projectId, name, agentType, runtime, systemPrompt?, icon?, modelProfileId?, modelProfileMode? }` | `Agent` | 创建项目级自定义 Agent；未指定档案时默认跟随全局 |
| `agents.update` | `{ agentId, name?, agentType?, runtime?, systemPrompt?, icon?, modelProfileId?, modelProfileMode? }` | `Agent` | 更新项目级 Agent；`modelProfileMode` 支持 `global|fixed|system`，固定模式必须选择档案 |
| `agents.bulkModelProfileMode` | `{ runtime, mode, projectId? }` | `{ count }` | 批量让 Runtime Agent 跟随全局档案或恢复系统配置 |
| `agents.delete` | `{ agentId }` | `{ deleted: true }` | 删除项目级 Agent |
| `agents.setHidden` | `{ agentId, hidden }` | `Agent` | 设置项目级 Agent 是否在工作台会话侧栏隐藏 |
| `agents.reorder` | `{ projectId, agentIds }` | `Agent[]` | 调整当前项目工作台左侧 Agent 顺序 |

`agents.create` 保留给 CLI 或旧调用方兼容；新 UI 不应绕过项目边界直接创建全局 Agent。

## Desktop Widget RPC

| Method | Params | Returns | Notes |
|------|------|------|------|
| `widget.sessionActivity.list` | `{ projectId? }` | `WidgetAgentProjectActivityGroup[]` | Groups relevant ordinary conversation Sessions by Agent and project. Autonomous `purpose=autonomy` Sessions are excluded. Includes every running, unread, or directly linked needs-input/blocked Session, bounded to 30 Sessions. |
| `widget.agentActivity.list` | `{ projectId? }` | `WidgetAgentActivityItem[]` | Agent-first bounded activity view over ordinary conversation Sessions. Autonomous Sessions are excluded; returns at most one representative Session per Agent and at most 20 Agents. |
| `widget.sessions.list` | `{ projectId?, filter?: "active" \| "all" }` | `WidgetSessionItem[]` | Session-first floating widget list over ordinary conversation Sessions. Autonomous Sessions are excluded; the default `active` filter returns running or unread sessions. |
| `widget.sessions.markRead` | `{ sessionId }` | `{ ok: true }` | Marks a widget session as read after validating the Session exists. |
| `widget.preferences.get` | `{ key? }` | `Record<string,string>` or `{ key, value }` | Reads widget preferences such as pinned project and pinned task Agent. |
| `widget.preferences.set` | `{ key, value }` | `{ ok: true }` | Saves or deletes a widget preference. |

`WidgetSessionItem.activityState` is derived from Session runtime-state evidence, not from `agents.status`. `agents.status = running` means the runtime process is online; it does not mean a specific Session is currently generating.

`WidgetAgentProjectActivityGroup` uses `agentId + projectId` as its grouping boundary. Each child Session retains independent `running`, `unread`, and `needsInput` flags plus a single display `attentionState`. Task fields only come from direct `sessions.task_id` or `task_steps.session_id` relationships. Results exclude completed read Sessions, are ordered by attention priority and activity time, and apply their limit to Sessions rather than groups.

`WidgetAgentActivityItem` selects one representative Session per Agent, prioritizing a running Session and then unread/recent activity. `taskId`, `taskTitle`, and `taskStatus` come from the latest Task assigned today through either `tasks.assigned_agent_id` or `task_steps.assignee_agent_id`; no Task fields are returned when the Agent has no assignment today. A running Session remains `running`, otherwise a latest Task in `needs_input`/`blocked` produces `needs_input`. Results are sorted by representative `activityAt` descending and limited to 20 Agents. Legacy Session-first Widget RPCs remain available for compatibility.

## 项目秘书 RPC

| 方法 | 参数 | 返回 |
|---|---|---|
| `secretary.list` | `{ projectId }` | 当前项目秘书列表（含邮件 `unreadCount` 与对话 `chatUnread`） |
| `secretary.get` | `{ projectId, secretaryId }` | 秘书配置、触发器与两类未读状态 |
| `secretary.create` | `{ projectId, name, executionAgentId, definitionPrompt?, reportPrompt?, observedAgentIds?, observeAll?, cron?, watchSessionDone?, watchTaskNeedsInput? }` | 新建秘书 |
| `secretary.update` | `{ projectId, secretaryId, name?, executionAgentId?, definitionPrompt?, reportPrompt?, observedAgentIds?, observeAll?, enabled?, cron?, watchSessionDone?, watchTaskNeedsInput? }` | 更新后的秘书；启停会同步定时规则 |
| `secretary.delete` | `{ projectId, secretaryId }` | `{ deleted: true }` |
| `secretary.runNow` | `{ projectId, secretaryId }` | `{ accepted: true, runId }` |
| `secretary.runs.list` | `{ projectId, secretaryId, limit? }` | 最近执行摘要；`limit` 为 1-50，默认 20，不返回 `payload_json` |
| `secretary.session.get` | `{ projectId, secretaryId, sessionId }` | 该秘书对应的 `secretary_runtime` 或 `secretary_chat` Session |
| `secretary.threads.list` | `{ projectId, secretaryId, unreadOnly? }` | 邮箱 Thread 列表 |
| `secretary.thread.get` | `{ projectId, secretaryId, threadId }` | Thread 详情 |
| `secretary.thread.markRead` | `{ projectId, secretaryId, threadId }` | 更新后的 Thread |
| `secretary.thread.archive` | `{ projectId, secretaryId, threadId }` | 更新后的 Thread |
| `secretary.chat.send` | `{ projectId, secretaryId, content }` | `{ sessionId }`（兼容入口；新 UI 直接打开秘书对话 Session） |

所有秘书 RPC 仅限 owner，并且服务端再次校验秘书与 `projectId` 的归属。实时 `secretary:update` 事件携带 `projectId`，配置变化、运行入队/开始/结束、邮箱变化、秘书对话完成及对话标记已读都会广播；PC/APP 仅刷新当前项目。`chatUnread` 由对话 Session 的 `last_message_at > last_read_at` 派生，不改变邮箱 `unreadCount` 的语义。
