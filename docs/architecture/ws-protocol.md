# WebSocket RPC 协议

## 连接

```
ws://localhost:18800
```

## 消息格式

所有消息为 JSON 对象，包含 `type` 字段。请求消息包含 `requestId`，响应消息用相同 `requestId` 回复。

## 订阅

连接后自动接收所有事件广播。客户端可通过 `subscribe` 消息选择性订阅。

## RPC 方法

### Agent 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `agents.list` | `{ projectId? }` | `Agent[]` | 列出 Agent，可按项目过滤 |
| `agents.create` | `{ type, name, runtime, config? }` | `Agent` | 创建全局/兼容 Agent；项目工作台优先使用模板部署或自定义项目 Agent |

### Session 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sessions.list` | `{ agentId?, projectId? }` | `Session[]` | 列出 Session |
| `sessions.create` | `{ agentId, taskId?, projectId? }` | `Session` | 只创建本地 SQLite Session；不启动 ACP runtime，也不创建 ACP session |
| `sessions.copy` | `{ sessionId }` | `Session` | 复制会话：先通过 ACP fork 复制 runtime 上下文，再复制 SQLite 中最近 10 条消息及相关 `session_events` |
| `sessions.rename` | `{ sessionId, title }` | `Session` | 重命名 Session |
| `sessions.close` | `{ sessionId }` | `Session` | 关闭 ACP 会话并标记为 closed |
| `sessions.archive` | `{ sessionId }` | `Session` | 归档 Session |
| `sessions.delete` | `{ sessionId }` | `{ deleted: true }` | 软删除 Session，默认列表不再返回 |
| `session.getModels` | `{ sessionId }` | `SessionCapabilities` | 获取模型/模式/配置选项 |
| `session.setModel` | `{ sessionId, modelId }` | `void` | 切换模型 |
| `session.setMode` | `{ sessionId, modeId }` | `void` | 切换模式 |
| `session.setConfig` | `{ sessionId, configId, value }` | `void` | 切换配置 |
| `session.cancel` | `{ sessionId }` | `{ ok: true }` | 通过 ACP `session/cancel` 停止当前轮次，不杀 runtime 进程 |
| `session.fork` | `{ sessionId }` | `Session` | Fork 会话 |
| `sessions.messages` | `{ sessionId, limit?, before?, includeToolCalls? }` | `Message[]` | 查询消息历史；默认不返回完整历史工具 JSON，只返回 `has_tool_calls` / `tool_call_count`，并返回 ACP diff 文件变更轻量摘要 `file_changes_json` / `has_file_changes` / `file_change_count` |
| `sessions.messageToolCalls` | `{ sessionId, messageId }` | `ToolCallSummary[]` | 懒加载单条消息的工具调用摘要 |
| `sessions.messageToolCallDetail` | `{ sessionId, messageId, toolCallId }` | `ToolCallDetail` | 懒加载单个工具调用详情，长输出会截断 |
| `sessions.messageFileChanges` | `{ sessionId, messageId }` | `FileChangeDetail` | 懒加载单条 Agent 消息的 ACP diff 文件变更详情 |
| `sessions.messageProcess` | `{ sessionId, messageId }` | `TurnProcessItem[]` | 懒加载单条 Agent 消息的执行过程轻量列表；按 `sequence` 升序返回，默认不返回大 `detail_json` |
| `sessions.processItemDetail` | `{ sessionId, messageId, itemId }` | `TurnProcessItem` | 懒加载单个执行过程块详情，例如工具 raw 输出、权限详情、计划详情或完整 diff |
| `sessions.messageEvents` | `{ sessionId, messageId }` | `SessionEvent[]` | 兼容旧数据的执行过程事件兜底恢复；新数据优先使用 `sessions.messageProcess` |
| `sessions.events` | `{ sessionId, limit?, afterSequence? }` | `SessionEvent[]` | 查询事件 |
| `prompt` | `{ sessionId, content, clientMessageId?, images? }` | `{ status }` | 发送消息；`clientMessageId` 用于让前端乐观用户消息与 SQLite 持久化消息合并；首次发送时懒启动 runtime，并按需 new/resume ACP session |
| `permission.respond` | `{ sessionId, permissionRequestId, optionId?, cancelled? }` | `void` | 响应权限请求 |
| `elicitation.respond` | `{ sessionId, elicitationRequestId, action, content? }` | `void` | 响应提问请求 |
| `decision` | `{ sessionId, messageId, choice }` | `void` | 响应决定 |

### Task 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `tasks.list` | `{ status?, projectId? }` | `Task[]` | 列出任务，可按项目过滤 |
| `tasks.create` | `{ title, description?, assignAgentId?, projectId? }` | `Task` | 创建任务 |
| `tasks.update` | `{ taskId, status?, stage? }` | `Task` | 更新任务状态 |

### Team 上下文

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `teams.current` | `{ sessionId }` | `{ team, currentMember, members, tasks, mailbox }` | 按当前普通会话反查 Team 上下文；非 Team 会话返回空上下文。Team 不是独立页面，Leader 和成员都通过各自 `session_id` 复用会话页。 |

### Rule 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `rules.list` | — | `Rule[]` | 列出所有规则 |
| `rules.create` | `{ name, cron, action, actionConfig }` | `Rule` | 创建规则 |
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
| `modelProfiles.create` | `{ name, runtime, providerId, contextWindow?, config }` | `ModelProfile` | 创建 Claude Code 或 Codex 模型档案 |
| `modelProfiles.update` | `{ profileId, ...fields }` | `ModelProfile` | 更新模型档案 |
| `modelProfiles.toggle` | `{ profileId, enabled }` | `{ ok: true }` | 启用或停用模型档案 |
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

服务端主动推送的事件类型：

| 事件 | 数据 | 说明 |
|------|------|------|
| `session:update` | `{ sessionId, agentId, data }` | 流式会话更新，包含消息、工具、权限、提问、计划和 `lifecycle.*` 阶段 |
| `session:process_item` | `{ sessionId, agentId?, item }` | 当前轮执行过程块的轻量增量；用于实时展示思考、工具、权限、提问、计划、文件修改等过程 |
| `session:event` | `{ sessionId, agentId?, event }` | 持久化事件 |
| `session:done` | `{ sessionId, agentId, messageId, turnId?, turnUsage? }` | Agent 回复完成；`turnId` 仅用于诊断日志/前后端事件关联 |
| `session:activity` | `{ sessionId, agentId, turnId?, state, reason, timestamp }` | 全局轻量事件：`running` 表示会话开始执行，`idle` 表示会话执行结束；用于左侧会话列表活动/未读提示，不承载聊天内容；`turnId` 仅用于诊断 |
| `session:capabilities` | `{ sessionId, capabilities }` | 会话能力信息 |
| `session:changed` | `{ sessionId, data }` | Session 标题、状态、归档/删除等列表元数据变更 |
| `agent:status` | `{ agentId, status }` | Agent 在线状态 |
| `task:update` | `{ taskId, data }` | Task 状态变更 |
| `team:update` | `{ teamId, sessionIds, data }` | Team 成员、任务或 mailbox 变化；前端仅在当前 `sessionId` 属于 `sessionIds` 时刷新 `teams.current`。 |
| `rule:update` | `{ ruleId, data }` | Rule 状态变更 |

Team 运行时事件：`team.member.spawn` 会广播包含新成员 Session 行的 `session:changed`。`team.member.message` 携带 `taskId` 时，会把 `backlog/planning` 的 Team Task 更新为 `executing`，再广播 `task:update` 与 `team:update`。工作台在当前 Team 匹配 `team:update` 时应刷新项目 agents/sessions/tasks。

## 类型定义

完整 TypeScript 类型定义见 `src/types/ws-protocol.ts`。

## 项目级约定

- 项目级能力（工作台、任务、自动化、文件浏览）必须携带 `projectId`。
- `projectId` 缺失时，只允许访问全局页（概览、Agent 广场、设置）。
- `session.getModels` 返回的 capabilities 由 ACP host 合并模型、模式、配置、命令等能力后上报。
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
| `agents.deployTemplate` | `{ projectId, templateId, name?, runtime?, systemPrompt?, icon?, modelProfileId? }` | `Agent` | 将全局模板部署为项目级 Agent |
| `agents.createCustom` | `{ projectId, name, agentType, runtime, systemPrompt?, icon?, modelProfileId? }` | `Agent` | 创建项目级自定义 Agent |
| `agents.update` | `{ agentId, name?, agentType?, runtime?, systemPrompt?, icon?, modelProfileId? }` | `Agent` | 更新项目级 Agent 配置；`modelProfileId` 为空值时清除绑定 |
| `agents.delete` | `{ agentId }` | `{ deleted: true }` | 删除项目级 Agent |

`agents.create` 保留给 CLI 或旧调用方兼容；新 UI 不应绕过项目边界直接创建全局 Agent。

## Desktop Widget RPC

| Method | Params | Returns | Notes |
|------|------|------|------|
| `widget.sessions.list` | `{ projectId?, filter?: "active" \| "all" }` | `WidgetSessionItem[]` | Session-first floating widget list. The default `active` filter returns running or unread sessions. |
| `widget.sessions.markRead` | `{ sessionId }` | `{ ok: true }` | Marks a widget session as read after validating the Session exists. |
| `widget.preferences.get` | `{ key? }` | `Record<string,string>` or `{ key, value }` | Reads widget preferences such as pinned project and pinned task Agent. |
| `widget.preferences.set` | `{ key, value }` | `{ ok: true }` | Saves or deletes a widget preference. |

`WidgetSessionItem.activityState` is derived from Session runtime-state evidence, not from `agents.status`. `agents.status = running` means the runtime process is online; it does not mean a specific Session is currently generating.
