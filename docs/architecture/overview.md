# 系统架构总览

> 本文档描述 AI IDE Studio v0.2.0 的**当前真实架构**，随代码同步更新。

## 系统拓扑

```text
客户端层
  Web UI / Mobile Web App / CLI / 外部调用方
      │ HTTP / CLI + WebSocket（同一公网 authority）
      ▼
Edge 主进程（唯一公网监听 HOST:PORT）
  edge/gateway.ts
      │ HTTP → 127.0.0.1:动态端口      │ Upgrade /realtime → 127.0.0.1:动态端口
      ▼                               ▼
API 子进程                       Realtime 子进程
  gateway/server.ts               realtime/service.ts
  gateway/http/*                  连接、认证、订阅索引、序列化、背压
  gateway/rpc/*                   每连接有界发送队列与游标恢复
      │                               ▲
      ├──── 长度前缀 Protobuf IPC ────┤
      │                               ▲
      │                         Runtime 流专用 IPC
      │                               │
      │                         Runtime 进程
      │                         ACP、Session actor、终端与交互
      │                         25ms 可见流 / 250ms 持久化流
      │                               │ stdio NDJSON
      │                               ▼
      │                         Claude / Codex ACP runtime
      │
      ├── Data Ports / Worker Threads │
      │     ports/query-port.ts          异步查询契约
      │     ports/write-data-port.ts     封闭写入批次契约
      │     data-worker/query-worker/*   单只读 SQLite 连接
      │     data-worker/writer-worker/*  优先级队列、唯一新写路径与 Outbox
      │     queries/task-list-query.ts   任务列表读模型
      │ mitt 事件总线
      ▼
Core 业务层（API 进程）
  sessions.ts / tasks.ts / projects.ts / agents.ts / teams.ts / event-center.ts / events.ts / knowledge-base.ts
      │
      ├── Store 持久层
      │     db.ts                  SQLite 初始化、旧 JSON 导入
      │     migrator.ts            schema_migrations 执行器
      │     migrations/*           SQLite schema 迁移
      │     agents/sessions/tasks/teams/rules/tools/skills 等实体 CRUD
      │
      └── Tools / MCP 层
            resolver.ts             将平台工具解析为 ACP MCP server
            registry/*              工具可见性与 token 上下文
            runtime/*               工具执行与审计
            mcp/http-mcp-server.ts   HTTP MCP 入口
```

## 数据流

### 用户发送消息

```text
PC Web UI → HTTP POST /api/v1/commands → durable command ledger → Session command service
Mobile / Guest / rollback → Realtime WS "prompt" → Protobuf IPC 兼容桥 → same Session command service
  → sessionManager 持久化用户消息 → RuntimePort.ensureSession() / prompt()
  → Runtime Session actor → Claude / Codex ACP runtime (stdio NDJSON)
  → ACP session/update → Runtime 25ms 合并 → Runtime→Realtime 专用 IPC → Web UI
  → Runtime 250ms 合并 → Runtime→API 控制 IPC → Core 投影 → Writer Worker
  → Runtime done barrier → API critical commit + Outbox → committed done → Realtime → Web UI
```

前端实时对话以 `session:update` 作为可见流式状态来源；`session:event` 主要用于持久化同步、断线恢复和状态补偿，避免每个流式 chunk 都全量还原事件。后端在用户发送后立即创建一条 `messages.status = running` 的 Agent 消息，流式文本写入 `messages.content` 快照；思考、工具、权限、提问、计划和文件修改等执行过程写入 `turn_process_items`，并通过 `session:process_item` 轻量广播。完成后同一条 Agent 消息更新为 completed/failed/cancelled。

PC 端历史消息默认通过轻量 HTTP `GET /api/v1/sessions/:sessionId/messages` 加载，`messages.content` 是最终回复快速来源；会话状态通过 `GET /api/v1/sessions/:sessionId/recovery` 恢复。Recovery 在 SQLite 查询阶段排除 `message.chunk`、`thinking.chunk`、`tool.call`、`tool.update` 和 `message.done` 等已经由 messages/process read model 承载的镜像事件，只返回配置、用量、计划和交互请求等状态事件，同时用 `latestSequence` 返回完整事件流游标。历史执行过程仍通过 `sessions.messageProcess` 按需加载 `turn_process_items` 的轻量列表，单个过程详情再通过 `sessions.processItemDetail` 懒加载。旧数据仍可通过 `sessions.messageEvents` 从 `session_events.sequence` 读取完整工具过程；工具摘要/详情继续支持 `sessions.messageToolCalls` / `sessions.messageToolCallDetail`，文件修改详情优先从 `turn_process_items` 读取并兼容旧的 `tool_calls_json`。

### PC 查询与命令传输边界

PC 端的任务列表、会话列表、消息历史、原始事件页和轻量 Recovery 使用版本化 `/api/v1` HTTP Query API。这些路由与旧 WS 兼容读取都委托异步 `QueryPort`；默认适配器把请求发送到独立 Query Worker，由该 Worker 独占 `readonly + query_only` SQLite 连接。同步 SQL 只阻塞 Query Worker，不占用 Gateway 事件循环。移动端行为保持不变。

HTTP 分页响应使用 `{ data, page: { hasMore, nextCursor } }`，普通列表和 snapshot 使用 `{ data }`。消息单页最多 200 条，事件与 Recovery 状态事件最多 1000 条；每个成功响应包含 `Server-Timing` 和 `X-Response-Bytes`，超过 1 MiB 观测预算时记录结构化告警但不截断。Task 列表不含完整 `description`，只返回最多 240 字的 `descriptionPreview`；打开详情时通过现有 `tasks.get` RPC 按需读取完整正文。PC 构建设置 `VITE_QUERY_TRANSPORT=ws` 可回滚这些读取，其余值和默认值均使用 HTTP。

PC 的 Prompt、取消、已读、权限响应和提问响应使用封闭的 `POST /api/v1/commands` HTTP Command API。每个命令同时携带 `commandId` 与 `Idempotency-Key`，Writer 在执行前写入 `runtime_commands` 账本；同 Session 的 turn、interaction、cancel 和 read-state 各自在独立 lane 内保持 FIFO，因此取消和交互响应不会排在未结束的 Prompt 后面。Prompt 返回 `202 accepted`，短命令等待完成后返回 `200`。API 重启按 `(created_at, command_id)` 游标分页读取全部 accepted/running 命令，不受单页 1000 条上限影响；已落用户消息的 running Prompt 会标记 interrupted，禁止重复发送。`VITE_COMMAND_TRANSPORT=ws` 是 PC 显式回滚开关，移动端和访客链路仍使用 WS 兼容命令。

WebSocket 的稳定职责是连接认证、Session 订阅、`ping/resume` 控制和服务端事件流，不作为 PC 高频 Query/Command 的默认传输。尚未迁移的低频领域 RPC继续通过 Realtime IPC 兼容桥进入 API。

### 公网 Edge 进程边界

默认 `EDGE_MODE=process` 时，Edge 主进程是唯一绑定公开 `HOST:PORT` 的组件。所有 HTTP 请求流式转发到仅绑定 `127.0.0.1` 动态端口的 API 子进程；所有 WebSocket Upgrade 请求转发到当前 Realtime loopback target。Edge 不导入 Store、Core 业务、Gateway RPC、ACP、Runtime、Realtime 实现或 SQLite，仅维护代理连接和当前内部 target。

Edge 监督 API 子进程，API 再监督 Realtime 与 Runtime。API 异常退出时 Edge 立即清空内部 target，HTTP 返回 503，随后在 API 恢复后热更新 target；公网监听端口不变。Realtime 重启只替换内部 WS target，浏览器发现地址始终是同源 `/realtime`。停止拥有公网端口的 Edge 进程会断开父 IPC，API 子进程执行完整关闭，继续回收 Realtime、Runtime 和 Worker 资源。

API 子进程通过 `uncaughtExceptionMonitor` 在致命退出前记录异常来源以及活动 Session、Agent、Project、turn 和最后进展。该监控只增强故障证据，不安装恢复型 `uncaughtException` / `unhandledRejection` handler，也不吞掉已经破坏进程可靠性的异常。API 退出仍会关闭其拥有的 Runtime 控制链并中断当前 active turns；Edge 自动重启恢复的是服务可用性，不代表旧 turn 可以续跑。

`EDGE_MODE=disabled` 保留原 API/Realtime 直连拓扑用于显式排障，不是正常部署模式。`REALTIME_MODE=embedded` 仍可在 Edge 后将 WebSocket 回滚到 API 事件循环，但不会增加第二个公网端口。

### 浏览器启动与项目缓存

PC 生产构建按页面使用 `React.lazy` 拆分，应用 shell、认证和连接发现保留在主入口；hashed JS/CSS 使用一年 immutable 缓存，HTML、SPA fallback 和未 hash 文件使用 `no-cache`。构建 manifest 由 `npm run check:ui-bundle` 检查主入口预算和动态页面数量。

浏览器在首次 React render 前最多等待 100ms 读取 IndexedDB `ai-ide-bootstrap`。快照只保存 Projects、最近五个项目的 Task/Agent/Session 列表以及最近会话的已完成消息，最大 4 MiB；running 流、权限、提问和执行中消息不持久化。hydrate 后所有条目立即标记 stale，正常 HTTP/WS 启动继续执行 SWR 重验，因此快照只加速显示，不成为事实源。

### Runtime 进程边界

默认 `RUNTIME_SERVICE_MODE=process` 时，独立 Runtime 子进程拥有 ACP adapter、Claude/Codex 子进程、每 Session 串行 actor、权限与 elicitation 等待项、终端进程、资源配额和流游标。Runtime 子进程不导入 Core、Store、Gateway、Query/Writer Worker 或 `better-sqlite3`，也不打开数据库。API 通过 `RuntimeStateSnapshot` 投影 Agent 配置、运行环境、system prompt、MCP server、Session 偏好、项目工作目录和持久化 ACP id；快照是可 `structuredClone` 的普通 DTO。

每个 Session actor 在一次所有权周期内使用固定 `streamGeneration`，只在实际输出逻辑 patch 时递增 `sequence`。文本 delta 按 message 合并，process item 采用 latest-wins；权限、elicitation 和 done 会先 flush 同 Session 的普通更新。Runtime 的可见流每 25ms 通过独立本机管道直达 Realtime，API 事件循环阻塞不会中断浏览器流式输出；持久化流以 250ms 节奏发送到 API，并带同一 Session 游标。

Runtime done 是持久化屏障，不直接对浏览器发布。API 按 Session 顺序处理持久化 patch，触发 `session:done`，等待 Writer 完成 `message.done + Outbox` 原子事务后才向 Runtime 返回 ack；随后 `session:committed_done` 才进入 Realtime。Runtime 意外退出时 API、HTTP、Query/Writer Worker 和 Realtime 保持运行，当前命令明确失败并由 Session 主链路落一条 error completion；监督器重启 Runtime，下一轮从 SQLite 快照和 `acp_session_id` 恢复。`RUNTIME_SERVICE_MODE=embedded` 保留旧 `acpHost` 作为显式回滚适配器，不会在运行中静默降级。

process Runtime 使用 API 投影到快照中的 HTTP MCP 配置调用平台工具。ToolRegistry、工具上下文、审计和业务写入仍由 API 进程所有；Runtime 与 Claude/Codex 子进程不打开平台数据库。相同 Session 上下文与可见工具集合复用同一 bearer token，项目、团队、Agent 或工具可见性变化时撤销旧 token 并生成新 token。embedded 回滚模式仍可使用 stdio 工具网关，不改变 process 模式的所有权边界。

Runtime 为每个活动 turn 保存原始 `messageId`、`turnId` 和 stream generation。取消先请求 ACP cancel；未在宽限时间内终止时只关闭目标 ACP Session，仍未终止才重启所属 Agent。每次升级都会 fence 旧 generation，迟到输出不能进入下一轮；终态只使用原 turn identity 发布一次 `cancelled` done。API 不再清理本地 active 状态或伪造 `cancel-timeout-*` done，`session.cancel` 的 HTTP 200 表示 Runtime 已返回 `requested`、`not-active` 或明确失败。

Runtime 资源配额默认允许 32 个网络型 turn、`max(2, floor(cpuCount / 2))` 个 CPU 型终端和 2 个磁盘型终端。等待队列按 FIFO 唤醒；Session mailbox 同时受条目数和字节数限制，超过上限返回 `RUNTIME_BACKPRESSURE`，不会丢弃已经接受的关键工作。

Runtime 子进程分别记录 Agent 与 Session 的最近活动时间。周期 sweep 只回收没有活动 actor、没有待处理 permission/elicitation 的空闲 Session；持久化的 `acp_session_id` 和历史记录保留，下一次发送自动 resume。Agent 没有已连接 Session 且继续空闲后才停止 ACP 子进程。`RUNTIME_SESSION_IDLE_MS`、`RUNTIME_AGENT_IDLE_MS` 和 `RUNTIME_IDLE_SWEEP_MS` 分别控制两级阈值与扫描周期；停机时会先停止定时器并等待正在执行的 sweep。

Runtime 的 permission/elicitation 等待项由独立交互状态模块管理。超时、取消、Session unbind、Agent 退出或 Runtime 关闭都会先发布取消型 result，再解除 ACP Promise，保证 Realtime 和持久化状态同步清除卡片。Recovery 只恢复最新 `message.done` 之后的交互事件，已结束 turn 的历史请求不会重新阻塞输入；ACP 确认 Claude `bypassPermissions` 或 Codex `agent-full-access` 已生效后，Runtime 还会在 permission callback 边界优先用单次授权自动放行，避免 adapter 再次请求审批，同时不会把尚未生效的偏好误当作 full-access。

### Realtime 进程边界

默认 `REALTIME_MODE=process` 时，独立 Realtime 子进程独占浏览器 WebSocket、认证握手、Session 订阅索引、JSON 序列化和发送背压；API 进程不持有浏览器 socket。两者通过本机 named pipe（Windows）或 Unix domain socket 通信，消息使用 4 字节大端长度前缀和版本化 Protobuf envelope，业务 payload 为受类型约束的 UTF-8 JSON。Envelope 携带 `version`、`kind`、请求/会话/流游标和幂等元数据，单帧大小受 `REALTIME_IPC_MAX_FRAME_BYTES` 限制。

浏览器先请求 `GET /api/v1/realtime-config` 获取实际 `wsUrl`、协议版本、运行模式和兼容桥状态。Edge 模式返回当前公网 authority 的同源 `/realtime`，不会泄露内部端口；PC 与移动端每次重连都重新发现端点。PC 每 15 秒发送一次 `ping`，连续 30 秒没有收到任何入站帧时主动关闭静默失效的 socket 并重新发现端点；重连后仍先恢复订阅，再发送 cursor `resume`，最后通过 HTTP recovery 补齐状态。`EDGE_MODE=disabled` 时 discovery 返回直连 Realtime 地址。`REALTIME_MODE=embedded` 是显式回滚模式；`REALTIME_LEGACY_RPC=enabled` 保留尚未迁移到 HTTP 的旧领域 RPC，关闭后 Realtime 只接受 `subscribe`、`unsubscribe`、`resume` 和 `ping`。

每个连接有独立的消息数和字节数上限。文本 delta 按消息合并，process item 采用 latest-wins，`session:done`、权限/提问和错误保持关键 FIFO；客户端跟不上、序列跳号或 generation 变化时发送 `resync_required`，由客户端重新读取 HTTP snapshot。Realtime 分别跟踪“已接收入站 cursor”和“已发送 cursor”，在前一帧仍 in-flight 时不会把连续的新帧误判为 gap。一个慢客户端只消耗自己的有界队列，不能拖住其他连接。API 进程监督 Realtime 异常退出并自动重启；HTTP、Query Worker 和 Writer Worker 在重启期间继续服务。

### SQLite Worker 边界

应用启动时先完成 schema migration、旧 JSON 导入和内置数据 seed，再启动一个 Query Worker 和一个 Writer Worker。Query Worker 只读；Writer Worker 的新写路径按 `critical / interactive / background` 排队。Background 最多等待 25ms，并在达到 100 个 mutation 或 256KiB 时提前提交；critical 先提交同一 Session 已排队的 background mutation，再单独提交。

Session 流式事件、running message snapshot 和 `message.done` 已通过 `WriteDataPort` 进入 Writer Worker。每个活动 Session 使用 `streamGeneration + sequence` 排序，重试通过 `batchId` 去重。`message.done` 与 Outbox 在同一事务提交，Gateway 只在 commit ack 后广播线上的 `session:done`。因此浏览器收到完成事件时，HTTP Snapshot 已可读取最终持久化状态。

API 领域 Command、工具和部分同步状态修改仍使用兼容 Store 连接。`tests/unit/database-access-boundary.test.ts` 锁定主线程直接 `getDb()` 的兼容清单，清单只能缩小；`tests/unit/runtime-boundary.test.ts` 锁定 Runtime 子进程的反向依赖禁令。`DATA_WORKER_MODE=local` 是显式故障回退开关，不会在 Worker 崩溃后自动降级到同步 SQL。

Query/Writer Worker 的完成日志包含优先级、队列深度、排队时间、执行时间、总耗时和载荷字节数。`DATA_WORKER_SLOW_MS` 配置慢请求阈值，默认 100ms；达到阈值的成功请求提升为 `warn`，用于区分排队拥塞和 SQL/事务执行缓慢。

Writer 独占 SQLite 维护。周期任务先 drain 写调度器，只删除超过保留期且 `published_at IS NOT NULL` 的 Outbox，运行 `PRAGMA optimize`，并在 WAL 达到 64 MiB 时执行 PASSIVE checkpoint；正常停机在 Session persistence flush 后执行 TRUNCATE checkpoint。未发布 Outbox、messages 和 session_events 永不由维护任务删除。

Edge、API、Realtime、Runtime 各自使用 `monitorEventLoopDelay` 和 event-loop utilization，每 30 秒记录 p50/p95/p99/max lag、RSS/heap，以及本进程的代理连接、active prompt、连接/订阅/发送队列或 Runtime actor/coalescer backlog。`EVENT_LOOP_MONITOR_INTERVAL_MS` 和 `EVENT_LOOP_WARN_THRESHOLD_MS` 控制采样周期与告警阈值。

`session:activity` 是独立的轻量全局事件，只表示会话本轮执行从 `running` 到 `idle` 的状态变化，用于左侧会话列表运行中/未读提示；它不承载聊天内容，也不参与历史消息还原。

桌面悬浮 Widget 也使用 `session:activity`，但不订阅完整 `session:update` 聊天流。Widget 通过 `widget.sessions.list` 获取会话优先的轻量 DTO：后端聚合 Session、Agent、Project、Task、运行态和已读状态，只把运行中或未读的 Session 暴露给小窗口。


### 创建任务

```text
Web UI → WS "tasks.create" → ws-handler → gateway/rpc/tasks
  → taskManager.createTask() / taskStore.create()
  → mitt "task:update" → ws-handler 广播 → Web UI / 其他订阅方
```

协作任务由 `tasks.create` 创建 draft 空壳，再通过 `tasks.step.*` 编排步骤并由 `tasks.start` 派发。简单任务走 `tasks.createSimple`，后端复用 `core/task-simple.ts` 创建默认 step 并立即派发。Agent 对话任务化的 MCP 入口使用 `studio.task.create(selfExecute=true)`，由 `taskManager.createTask()` 创建默认 step 并跳过 prompt 注入。任务 prompt 文本构造集中在 `core/task-prompt.ts`，避免任务生命周期逻辑与长模板耦合。

任务看板和 Workspace 右侧列表使用 Task summary read model，只携带状态、步骤摘要、最新汇报预览和 `descriptionPreview`。打开任务详情后，前端详情缓存通过 `tasks.get` 读取完整正文；详情请求有独立的 loading/error/retry 状态，不会把摘要误当成完整任务目标。

### 事件中心

```text
Agent MCP tool / Web UI → WS 或 MCP event.* → core/event-center
  → event_center_events + event_consumptions 持久化
  → mitt "event-center:update" → ws-handler 广播 → Event Center 页面刷新
  → 可选 eventConsumptions.run 创建消费者 Session 并发送消费 Prompt
  → 可选 events.convertToTask 创建普通 Task 并写入 event_task_links
```

事件中心用于承接“任务之前”的信号和候选工作。事件类别保存在 `event_categories`，事件固定元数据保存在 `event_center_events`，类别差异放入 `payload_json`；订阅规则保存在 `event_subscriptions`，匹配后生成 `event_consumptions`。事件被用户确认后可以通过 `events.convertToTask` 转为普通任务，任务仍归 `tasks` 状态机管理。

### 知识库 LLM Wiki

```text
Web UI / Agent MCP tool -> WS knowledge* 或 MCP core.kb.* -> core/knowledge-base
  -> knowledge_bases + knowledge_pages + knowledge_mounts + knowledge_activities
  -> mitt "knowledge-base:update" -> ws-handler 广播 -> 知识库页面刷新
```

知识库是项目可见的 markdown Wiki。每个项目懒创建一个 `kind=project` 项目库；`kind=shared` 库不绑定单一项目，通过 `knowledge_mounts` 多对多挂载到项目。页面使用 `[[标题]]` 和 `[[库名/标题]]` 解析双向链接；读取页面时返回出链和反向链接。AI 通过 `core.kb.*` 直接读写同一套数据，写入记录进入 `knowledge_activities`，撤销以 activity 快照为准，不做多版本合并。

`src=code` 的页面记录源文件路径和 sha256 指纹。读/列页面时会懒检测指纹变化并标记 `stale`；刷新不会自动调用 LLM，必须由人或 Agent 读取源文件后显式调用 `core.kb.refresh_from_code` 写入新正文。

### 管理 Session

```text
Web UI → WS "sessions.rename/delete/archive/close"
  → ws-handler → gateway/rpc/sessions → sessionManager
  → sessionStore 更新 title/status/archived_at/deleted_at
  → mitt "session:changed" → ws-handler 广播 → Web UI 更新左侧会话列表
```

Session 删除采用软删除，仅隐藏列表项并保留 `messages` / `session_events` 历史数据。项目工作台中的 `agents.list`、`sessions.list`、`tasks.list`、`sessions.create`、`tasks.create` 均应传递当前 `projectId`，避免跨项目混用 Agent、Task 和 Session。

项目 Agent 可以从当前机器导入 Codex / Claude Code 的 JSONL 本地会话。导入只解析原生会话 id 并写入新的平台 `sessions.acp_session_id`，不会复制或解析历史 `messages`、`session_events`、`turn_process_items`；后续发送消息时按普通懒连接流程恢复该 ACP 会话。

## 目录功能映射

| 目录 | 职责 | 核心文件 |
|------|------|----------|
| `src/acp/` | ACP 公共映射与 embedded 回滚实现 | `host.ts`、`capabilities.ts`、`runtime-registry.ts`、`update-mapper.ts` |
| `src/runtime/` | 独立 Runtime 服务、API 适配器、Session actor、流合并与资源配额 | `service/*`、`api/process-runtime-port.ts`、`actors/session-actor.ts`、`streams/runtime-update-coalescer.ts` |
| `src/core/` | 业务逻辑 | `sessions.ts`、`turn-process-runtime.ts`、`platform-presentation-results.ts`、`prompt-diagnostics.ts`、`session-event-payload.ts`、`tasks.ts`、`task-simple.ts`、`task-prompt.ts`、`task-steps.ts`、`projects.ts`、`agents.ts`、`teams.ts`、`event-center.ts`、`events.ts`、`knowledge-base.ts` |
| `src/ports/`、`src/queries/` | 异步查询边界与当前单体适配器 | `query-port.ts`、`local-query-port.ts`、`task-list-query.ts` |
| `src/gateway/` | API 对外接口与 Realtime 桥 | `server.ts`、`http/query-routes.ts`、`http/realtime-config-route.ts`、`realtime-event-source.ts`、`realtime-rpc-bridge.ts`、`ws-handler.ts` |
| `src/realtime/` | 独立实时服务 | `service.ts`、`hub.ts`、`outbound-queue.ts`、`process-client.ts` |
| `src/ipc/` | 跨进程传输 | `protobuf-envelope.ts`、`framed-socket.ts` |
| `src/shared/` | 跨进程共享基础设施 | `logger.ts` |
| `src/store/` | 数据持久化 | `db.ts`、`migrator.ts`、`migrations/*`、`turn-process-items.ts`、各实体 store |
| `src/tools/` | 工具平台与 MCP 发布 | `resolver.ts`、`tool-gateway.ts`、`registry/*`、`runtime/*`、`mcp/http-mcp-server.ts` |
| `src/cli/` | 命令行工具 | `index.ts`、agents/sessions/tasks/rules 子命令 |
| `src/types/` | 类型定义 | `ws-protocol.ts` |
| `ui/src/pages/` | PC 端页面组件 | Workspace/Dashboard/TaskBoard/Schedule/EventCenter/AgentSquare/ToolManager/Settings |
| `ui/src/stores/` | 前端状态 | Zustand store、`session-events.ts` 事件还原、项目/工具/模板/模型状态 |
| `ui/src/services/` | 通信层 | `query-client.ts`、`ws-client.ts` |
| `mobile/src/` | 移动端 Web App | `/app/` 下的手机端页面、组件和 Zustand store；复用 `ui/src/services/ws-client.ts` 与会话事件还原辅助逻辑 |

## PC 项目路由与前端状态边界

PC 端项目页面以 `/p/:projectId/*` 为 URL 真源。Workspace、任务、自动化、事件中心、知识库和 Agent 记忆均位于该路由边界内；Dashboard、Agent 广场、工具、设置、分享页和 Widget 保持全局路由。旧的无项目前缀链接会重定向到当前有效项目，移动端路由和状态管理不受该边界影响。

`project-data-scope` 是项目切换的前端编排边界。路由项目变化时，它每次都同步激活各 Zustand store 的项目分区缓存，再发起后台刷新；同一项目的并发导航只合并网络刷新，不合并 Store 激活，因此 A → B → A 快速切换不会把 B 的投影留在 A 页面。Task、Agent、Session 列表、文件树、规则、知识库、事件中心和 Agent Memory 均按项目或更细的 Agent/维度 scope 缓存；缓存采用 30 秒 stale-while-revalidate、逐 scope 请求序号和 LRU 淘汰，迟到响应只能写回自身 scope，不能覆盖当前项目投影。Agent、Session 和消息的首次加载显式区分加载中、失败可重试和真实空列表。

WebSocket 实体更新按实体携带的 `project_id` 写入目标缓存。只包含实体 ID 的局部更新会修改所有命中的已访问 scope；无法安全合并的集合更新只标记目标 scope 失效，并仅刷新当前可见项目。Session 的消息、事件和流式执行状态继续按 `sessionId` 使用既有缓存，不复制到项目列表缓存。

PC Session store 对取消维护独立的 stopping 状态。首次点击立即显示“正在停止”，同一活动 turn 的重复点击复用同一 Command ID 和 in-flight Promise；取消失败保留 running 并暴露错误，`session:done` 或 idle activity 清理 stopping。用户可以在 stopping 期间编辑下一条消息，该 Prompt 等待取消 Promise 完成并只在 HTTP 202 accepted 后清空草稿和图片。Workspace 与全局助理遵循同一规则。

项目视图状态与业务数据缓存分离。每个项目独立保存 Workspace 侧栏与 Agent 选择、任务选中项和滚动位置、知识库搜索及未保存草稿、事件中心 Tab、Agent Memory 的 Agent/维度选择。低频选择状态持久化到浏览器存储，滚动位置只保存在内存；删除项目时路由记忆、视图状态、资源缓存和最后会话映射一并清理。

Session、Agent 和当前项目的运行中/未读提示使用同一个 Session 指示器汇总函数，且运行中优先于未读，避免三层展示出现不同计数。当前项目直接覆盖为本地 Session store 的实时汇总；后台项目保留 `sessions.projectStats` 的轻量全项目快照。该查询聚合 active、非删除、非归档、非模板会话，并把 SQLite 中的运行信号与进程内 active prompt 合并；PC stats store 在全局会话事件后更新，并以 30 秒 stale interval、页面重新可见和窗口 focus 作为恢复边界。移动端项目和 Agent 的展示顺序只使用创建顺序与后端 Agent 顺序，不会因未读或运行状态变化而重排。打开具体会话通过 `sessions.markRead` 持久化 `last_read_at`；当前可见 Session 在最终消息完成后再次确认已读，后台完成则保留未读直到页面重新可见，点击项目本身不会批量清除未读。

## 支持的 Agent 运行时

| 运行时 | 包 | 状态 |
|--------|-----|------|
| `mock` | 内置 | 可用（开发/测试） |
| `claude` | `@agentclientprotocol/claude-agent-acp` | 可用 |
| `codex` | `@agentclientprotocol/codex-acp` | 可用 |
| `gemini` | — | 未接入 |

## A2A Hub 跨机器通信

AI IDE Studio 作为 A2A Hub 的一个 provider 接入,通过 `agent_hub.*` MCP 工具让本地 Agent 跨机器互相调用。

```text
Agent MCP tool → agent_hub.connect → core/agent-hub/connection-manager
  → POST {hubUrl}/hub/v1/agents/register (provider token, transportMode=sse)
  → 起 SSE 长连接 GET /hub/v1/agents/{registrationId}/stream
  → 返回 hubAgentId / 可见 Agent 列表
```

注册粒度是 `(Agent, Session)` 组合,每个 session 独立 connect、独立 SSE、独立可见。`machineId` 持久化在本地 `settings` 表,首次 connect 时生成(`mac-` 前缀 + 8 位 hex),塞进 `instanceId` 和 `name` 后 4 位,别的机器能区分。同 `provider + instanceId` 重复 connect,Hub 返回相同 `registrationId` 和 `hubAgentId`,不会因重连断链。

`agent_hub.send` 异步发送:Hub 返回 `hubTaskId` 后立即返回,对方处理完成后 Hub 通过同一 SSE 通道推 `result` event,`task-relay` 把结果以 `[Hub 回复 from {对方name}]: ...` 注入回原 session。inbound 任务通过 SSE `task` event 接收,按 `contextId` 复用或新建本地 session,完成后通过 HTTP POST 回传 Hub 的 push url。

session 关闭(close/archive/delete)自动 `disconnectBySession`:off 所有未完成的 doneListeners、DELETE Hub 注册、关 SSE、清内存。inbound 任务的本地 session 不主动关,让其自然完成或超时回收。

模块组织见 `src/core/agent-hub/`:`config.ts`(内置配置)、`machine-id.ts`(并发锁持久化)、`naming.ts`(name/description/scopeKeys 规则)、`connection-manager.ts`(HubConnection 状态)、`sse-client.ts`(SSE 客户端 + 重连)、`hub-client.ts`(HTTP 客户端)、`task-relay.ts`(出/入站任务中继)、`index.ts`。

## 当前架构约束

- `projectId` 是项目级实体与项目内 Session/Task 的核心边界。
- `agent_templates` 是全局模板库；`agents` 是部署到具体项目后的运行时实例。
- `global_assistant` 保存应用唯一全局助理绑定；它复用普通 Agent/Session，但 ACP `cwd` 来自 `global_assistant.workspace_dir`。
- Team 是项目级协作容器；TeamMember 绑定项目级 Agent 与当前团队 Session，Team Task 复用 `tasks.team_id`。
- Event Center 是项目级事件收件箱；事件可以被忽略、消费、归档或转为普通 Task，但不会替代 `tasks` 的交付状态机。
- Knowledge Base 是项目可见知识层；项目库绑定单项目，shared 库通过挂载进入项目可见范围，AI 和人读写同一份 markdown 页面。
- 非 Team Agent 间通信使用 `agent.*` MCP 工具和普通 Session 投递；平台记录通信与 watch 状态，但不引入独立通信线程。
- 默认模式下 `src/realtime/` 独占 WebSocket、订阅与背压，且禁止依赖 Core、Store、SQLite 或 Gateway RPC；`ws-handler.ts` 仅保留 embedded 回滚和 API 侧兼容 RPC 执行。
- SQLite schema 由 `src/store/migrator.ts` 与 `src/store/migrations/*` 管理；`db.ts` 不再承载大段建表/升级逻辑。
- 默认 HTTP Query 和 Session 流式持久化不得在 Gateway 调用栈执行同步 SQLite；新增数据访问必须通过 QueryPort/WriteDataPort。
- Query Worker 不得写库；Writer mutation 必须使用封闭 union，禁止通过 MessagePort 发送任意 SQL。
- API 只通过 `RuntimePort` 操作 ACP；process Runtime 不得导入 embedded `acpHost` 或读取其连接内部状态。
- `tools` / `tool_bindings` / `skills` / `model_providers` / `model_profiles` 为全局可扩展能力表。
- MCP 工具平台目标架构见 `docs/architecture/mcp-tool-platform.md`，第一版按方法级可见性控制推进。
- ACP 对话生命周期、runtime/session/thread 对应关系与懒连接设计见 `docs/architecture/acp-session-lifecycle.md`。

## 项目级 Agent 边界

`agent_templates` 是全局模板库，类似工具箱；`agents` 是模板部署到具体项目后的运行时实例。项目工作台只展示当前 `projectId` 下的 Agent，Session、Task、文件浏览和工具上下文都沿用同一个项目边界。

创建或恢复 ACP Session 时，后端会从 Session 的 `project_id` 找到 Project，并把 `work_dir` 作为 ACP `cwd` 传给 runtime；同时按 `agentId/projectId/sessionId` 解析本轮可见的 MCP 工具。

项目级 Agent 可以在 `config_json.modelProfileId` 上绑定一个模型档案。模型档案按 runtime 区分 Claude Code 与 Codex，并保存供应商、模型映射和上下文窗口；Agent runtime 改变、档案删除或档案 runtime 改变时，后端会清理不再匹配的绑定。

详细流程见 `docs/architecture/project-agent-workflow.md`。

## Agent 会话通信

非 Team 场景下，Agent 通过 `agent.message.send` 向另一个 Agent 的 Session 发送平台消息；只指定 `targetAgentId` 时，后端创建新的目标 Session，不复用最新会话。消息来源的 `sourceAgentId`、`sourceSessionId` 和 `projectId` 由当前 MCP tool context 注入，业务关联信息统一放入 `relatedInfo` JSON。

投递链路不阻塞调用方整轮执行：后端先写入 `agent_session_messages`，再后台调用 `sessionManager.enqueuePrompt(targetSessionId, prompt)`。`needReply` 只表示目标 Agent 完成后应主动调用 `agent.message.send` 回到来源 Session；如果目标 Session 完成后仍未检测到反向消息，系统最多补发一次提醒。

`agent.watch.create` 记录一条 `agent_session_watches`，用于在被监听 Session 下一次 `session:done` 后唤醒 watcher 所在 Session。watch 默认只触发一次；如果被监听 Session 已经通过 `agent.message.send` 给 watcher 发过消息，watch 会标记触发但抑制重复 prompt。

## Team MCP 协作边界

Team 能力通过 `team.*` MCP tools 暴露给 Agent。`team.*` 方法只注册为内置工具，不做全局默认绑定；工具 handler 不判断 leader/member 权限，只校验 Team、Member、Task 与 Project 的一致性。谁能看到 `team.member.spawn`、`team.member.message` 等方法，由 Agent 级工具绑定或 Team Profile 写入的 `tool_bindings` 控制，并最终固化到 MCP token 的 `visibleTools`。

TeamMember 的 `session_id` 指向普通 `sessions` 行，成员执行输出继续落到 `messages` 和 `session_events`，所以刷新或切换会话后仍能按现有会话事件恢复。团队上下文通过 ToolContext 的 `teamId` / `teamMemberId` 传递，成员调用 `team.mailbox.send`、`team.task.update` 时不需要在 prompt 中手写 Team ID。`team.member.spawn` 创建或加入成员后，会自动给成员 Agent 套用 `team-member` Profile，让成员后续会话具备汇报和更新团队任务的基础工具。

前端工作台不为 Team 提供独立页面。`teams.current(sessionId)` 按当前会话反查 Team 上下文；右侧上下文区展示成员、任务和 mailbox，点击成员只切换到该成员的普通 Session。Team 变化通过 `team:update` 广播触发当前会话上下文刷新。

Team 运行时事件规则：`team.member.spawn` 会广播包含完整成员 Session 行的 `session:changed`，并为所属 Team 广播 `team:update`。`team.member.message` 携带 `taskId` 时，会把 `backlog/planning` 的 Team Task 推进到 `executing`，并同时广播 `task:update` 与 `team:update`。内部 Team MCP 权限自动放行仅限当前会话可见、且工具定义不需要审批的 `team.mailbox.send` 与 `team.task.update`。

## ACP 懒生命周期

- `sessions.create` 只创建本地 SQLite 行；在真正连接 session 前，`acp_session_id` 保持为空。
- 首次 `prompt`，或显式切换 model/mode/config 时，调用 `RuntimePort.ensureSession()` 启动 Agent runtime，并创建或恢复 ACP session。
- 同一个 Agent 可以同时保持多个 ACP session 连接；平台只拒绝同一个本地 Session 内的并发 turn。
- Runtime 关闭 Session 或进程时释放 ACP、终端和交互资源；已持久化 messages/events 和 `sessions.acp_session_id` 都会保留。
- Session 级 runtime preferences 保存在 `sessions.runtime_preferences_json`。API 把偏好放入快照，ACP session 创建、恢复、加载或 fork 后由 Runtime 恢复 model/mode/config。

## 未实现的设计目标

以下在设计文档中有描述，但当前代码未实现：

- Memory/RAG 记忆系统
- 事件触发自动化执行（当前只有规则/定时管理）
- 插件系统


## Session Update Scheduling

`src/core/events.ts` keeps the public `session:update` event contract. Embedded updates and process Runtime persistence patches enter `SessionUpdateActorScheduler` before API consumers run; process Runtime visible patches have already been ordered and coalesced by the Runtime Session actor and travel directly to Realtime.

Scheduler output is emitted back through the internal mitt bus as the same `session:update` event, so `sessions.ts`, `turn-process-runtime.ts`, and `ws-handler.ts` continue to subscribe through the existing interface. Critical boundaries such as permission or elicitation prompts, lifecycle updates, usage/config/sessionInfo updates, terminal tool statuses, and `session:done` flush the matching session queue before persistence, finalization, or broadcast continues.

## MCP Tool Context Boundary

Platform MCP tools use the session tool context as the source of truth for project, Team, member, current Agent, and session identity. Runtime schema sanitization hides system-owned fields from model-visible schemas, while handlers still validate business target IDs against the current project or Team before creating sessions, tasks, or Team records.
