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
      │     queries/task-list-query.ts   任务完整列表与分页读模型
      │     store/task-page.ts           Task ID 游标、项目/时间/状态筛选
      │ mitt 事件总线
      ▼
Core 业务层（API 进程）
  sessions.ts / tasks.ts / projects.ts / agents.ts / teams.ts / event-center.ts / events.ts / knowledge-base.ts
  agent-autonomy.ts / agent-autonomy-scheduler.ts / project-secretary.ts / project-secretary-history.ts / project-secretary-triggers.ts
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

## Electron 桌面连接边界

Electron 使用统一的 `DesktopRuntimeTarget` 驱动主窗口、Widget、托盘导航和退出清理。桌面主窗口 renderer 使用 90% 内容缩放，普通 Web 不继承该设置。桌面主窗口、首次设置窗口、Widget、托盘及 Windows 安装包使用同一份品牌图标资源。`managed-local` 模式由主进程生成临时访问密钥、启动打包内的 Node 后端并拥有该进程；`remote` 模式不创建本地后端，直接加载远程服务器提供的 PC UI，因此 HTTP、WebSocket 和静态资源继续保持同源，UI 与服务器版本也由同一次部署保证。Widget 打开主窗口内容时优先通过受限 preload IPC 触发 BrowserRouter 内部导航，仅在 renderer 未就绪时回退到 `loadURL`；从最小化恢复时重新应用已记录的最大化/全屏状态。主窗口关闭表示退出整个桌面应用，Electron `before-quit` 统一清理 Widget、托盘和受管本地后端；Widget 自身的最小化操作只隐藏悬浮窗。

桌面连接 profile 保存在 Electron `userData`，不进入服务器 SQLite。远程 token 由 `safeStorage` 保护，renderer 只在启动阶段通过受限 preload bridge 取得当前连接上下文，并在任何 HTTP/WS bootstrap 前写入认证状态。主窗口加载后会移除 URL 中的 token。连接模式和 Widget 开关采用保存后重启语义，避免旧服务器的 WebSocket、Recovery cursor、Zustand 缓存或本地子进程与新连接混用。

普通浏览器没有 `electronDesktop` preload bridge，继续使用既有 Web bootstrap。远程模式中的项目目录、数据库、Runtime、终端和文件工具都属于服务器；桌面本地文件代理不在该连接边界内。

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

### 自主 Agent 检查

```text
Rule Engine（每 10 分钟）
  → agent-autonomy-scheduler 检查 enabled / due / Session busy
  → 忙碌时跳过，不向 Session 队列追加 Prompt
  → 固定 purpose=autonomy Session 进入同一 Session command/runtime 主链路
  → Runtime snapshot 只为该 Session 追加独立自主提示词与 memory.md 绝对路径
  → Agent 用 studio.autonomy.plan.update 维护当天排班
  → Agent 用 studio.autonomy.report 写入 Markdown 汇报并发布 autonomy:update
  → PC 自主工作页刷新报告、排班和工作记忆
```

每个项目 Agent 最多拥有一个未删除的自主 Session。自主 Session 与普通对话共享 ACP、消息持久化、取消和恢复能力，但不进入 Workspace 普通会话列表或项目会话统计；用户仍可从自主工作页按 `sessionId` 打开完整会话。启用时 Claude 必须由 Runtime 确认 `bypassPermissions`，Codex 必须确认 `agent-full-access`，未确认时不会启用心跳规则。

项目秘书是独立于自主 Agent 的项目级实体。秘书使用隐藏的 `secretary_runtime` Session 执行定时/事件触发，并使用独立的 `secretary_chat` Session 处理用户对话；两个 Session 共享秘书定义、工作项目和邮箱 Thread，但都从普通 Session 列表、项目会话统计和普通未读缓存排除。秘书页面通过受项目和秘书双重校验的定向读取接口，把这两个隐藏 Session 临时交给现有 PC Workspace / APP Chat 页面，离开后释放临时 Session 状态，不重复实现消息、工具和文件展示。秘书摘要分别保留邮箱 `unreadCount` 与对话 `chatUnread`；PC/APP Shell 常驻监听 `secretary:update`，在项目导航、秘书列表和对话入口提供可达提醒，打开对话并标记 Session 已读后同步刷新。`project-secretary-triggers` 负责将秘书的启停、Cron 和事件开关同步到 Rule 与 Trigger，停用秘书会同步暂停其定时规则。秘书触发先写入持久化运行队列，再串行入队 Prompt；排队、开始、成功或失败均通过轻量执行摘要和 `secretary:update` 暴露，不返回内部触发 payload。`session:committed_done` 只在项目和观察 Agent 匹配时创建运行请求，避免跨项目读取和忙碌跳过造成漏报。`secretary.report` 只向秘书运行/对话 Session 暴露，并写入固定邮件 envelope；`studio.secretary.list/get/create/update/delete` 只向普通 `conversation` Session 暴露，项目身份来自可信 ToolContext，模型不能跨项目管理秘书。附件只保存项目相对路径，正文和文件查看继续复用现有 Markdown/文件读取链路。

项目灵感工作台是 PC 端的项目级记录与任务候选入口。未设置人工标题时，系统直接使用正文连续原文生成定长自动标题。每个项目维护一个当前长期灵感 Session，用户保存 Markdown 和图片原文后，后台把整理请求串行投递到这个 Session，使持续讨论和自动整理共享上下文。从具体结果进入会话时，平台为每条用户消息附加可信 `noteId` 模型上下文，AI 先调用仅在该 Session 可见的 `inspiration.note.get` 读取最新原文和方案；普通聊天历史不作为灵感身份来源。Agent 只有调用 `inspiration.analysis.publish` 才会暂存新方案，同一轮可反复修正，Session 正常结束后才提交最后一份有效结果。人工完成标记独立于 AI 整理状态，PC 默认显示进行中灵感并可切换已完成或全部；编辑、重新整理或发布新方案会自动重新打开。该 Session 隐藏平台任务创建、步骤编排和 Schedule 变更工具，不能绕过人工确认直接派发。revision 与内部 attempt 双重 CAS 阻止旧回复或旧轮次覆盖新编辑；候选确认后才复用标准 Task/Step/Session 链路执行。

全局阅读库使用 `reading_items` 保存 AI 生成内容的轻量来源元数据，不把 Markdown、HTML 或外部网页正文复制进数据库。`reading.add` 只接受标题、类型和内容，项目、Session 与 Agent 从可信 ToolContext 注入；MD/HTML 路径属于 Gateway 所在机器。`/reading/:itemId/*` 按条目挂载源文件所在目录，使用与 Preview 相同的 token→限定 Path Cookie、MIME 和目录越界检查语义；URL 只允许 HTTP 或 HTTPS，由客户端直接 iframe 并始终保留外部浏览器入口。PC `/reading` 与 APP 阅读 Tab 共用 `reading.list/get/update`，进入页面、回到前台或显式刷新时重新读取，不新增实时 WS 事件，也不改变 Workspace 当前项目或会话状态。

灵感任务的执行目标独立于整理 Agent 和整理 Session。项目可保存默认任务 Agent、默认任务 Session 及默认优先或 AI 推荐优先策略；确认候选时，目标解析模块按人工选择、项目策略和候选推荐顺序确定 Agent，并在创建草稿或立即派发前统一校验 Session 的项目归属、Agent 归属及可用状态。

前端实时对话以 `session:update` 作为可见流式状态来源；`session:event` 主要用于持久化同步、断线恢复和状态补偿，避免每个流式 chunk 都全量还原事件。后端在用户发送后立即创建一条 `messages.status = running` 的 Agent 消息，流式文本写入 `messages.content` 快照；思考、工具、权限、提问、计划和文件修改等执行过程写入 `turn_process_items`，并通过 `session:process_item` 轻量广播。完成后同一条 Agent 消息更新为 completed/failed/cancelled。

PC 端历史消息默认通过轻量 HTTP `GET /api/v1/sessions/:sessionId/messages` 加载，`messages.content` 是最终回复快速来源；会话状态通过 `GET /api/v1/sessions/:sessionId/recovery` 恢复。Recovery 在 SQLite 查询阶段排除 `message.chunk`、`thinking.chunk`、`tool.call`、`tool.update` 和 `message.done` 等已经由 messages/process read model 承载的镜像事件，只返回配置、用量、计划和交互请求等状态事件，同时用 `latestSequence` 返回完整事件流游标。历史执行过程仍通过 `sessions.messageProcess` 按需加载 `turn_process_items` 的轻量列表，单个过程详情再通过 `sessions.processItemDetail` 懒加载。旧数据仍可通过 `sessions.messageEvents` 从 `session_events.sequence` 读取完整工具过程；工具摘要/详情继续支持 `sessions.messageToolCalls` / `sessions.messageToolCallDetail`，文件修改详情优先从 `turn_process_items` 读取并兼容旧的 `tool_calls_json`。

`files.present` 的消息摘要只持久化路径和文件元数据。文本通过 `fs.read` 按需读取；图片、音频、视频通过 owner-only 的 `fs.assetUrl` 获取一小时短期 HMAC 地址，再由 `/api/fs/asset` 以完整流或单段 HTTP Range 返回。签名地址不包含长期本地 token，过期后客户端根据持久化路径重新签发。项目相对路径禁止逃逸，显式服务器绝对路径保留既有特权语义；Markdown 内资源由服务端按文档目录、项目根路径、Windows/UNC/`file://` 绝对路径解析，HTTPS 外部资源直接加载。PC 和 APP 使用同一资源语义，APP 显式传递 presentation 的项目 ID。

Workspace 的 Agent 会话栏提供作用域明确的批量管理入口。批量操作必须同时携带当前项目、Agent 和会话 ID，服务端重新查询并校验归属；批量已读复用现有 `last_read_at` 时间戳，批量删除复用 Session 软删除和 Runtime 清理链路。主会话、运行中会话以及自主/秘书等系统会话不会被批量删除，删除结果按会话返回成功或跳过原因，不引入新的数据库字段或全局管理页。

### PC 查询与命令传输边界

PC Workspace 的普通文件通过受 owner token 保护的 `POST /api/v1/session-files` 单文件二进制流上传。API 校验 Project 与 Session 归属后，将文件原子写入 `DATA_DIR/attachments/sessions/<project>/<session>/<uploadId>/`，限制文件名和接收字节数，并把服务器绝对路径返回给 Workspace；发送 Prompt 时该路径作为可见附件说明进入现有消息链路。图片继续使用既有 image block，不经过普通文件通道。远程桌面 Client 上传到远程 Gateway，因此 Runtime 收到的始终是服务器可读路径；该能力不修改项目源码目录、移动端或全局助手。

PC 端的任务列表、会话列表、消息历史、原始事件页和轻量 Recovery 使用版本化 `/api/v1` HTTP Query API。这些路由与旧 WS 兼容读取都委托异步 `QueryPort`；默认适配器把请求发送到独立 Query Worker，由该 Worker 独占 `readonly + query_only` SQLite 连接。同步 SQL 只阻塞 Query Worker，不占用 Gateway 事件循环。移动端行为保持不变。

HTTP 分页响应使用 `{ data, page: { hasMore, nextCursor, total? } }`，普通列表和 snapshot 使用 `{ data }`。消息单页最多 200 条，事件与 Recovery 状态事件最多 1000 条；每个成功响应包含 `Server-Timing` 和 `X-Response-Bytes`，超过 1 MiB 观测预算时记录结构化告警但不截断。Task 的 `tasks.page` 默认 50、最大 200，按 `created_at DESC, id DESC` 排序并把上一页最后一个 Task ID 作为下一页游标；旧 `tasks.list` 保留完整数组兼容。Task 摘要不含完整 `description`，只返回最多 240 字的 `descriptionPreview`；打开详情时通过现有 `tasks.get` RPC 按需读取完整正文。PC 构建设置 `VITE_QUERY_TRANSPORT=ws` 可回滚这些读取，其余值和默认值均使用 HTTP。

PC 的 Prompt、取消、已读、权限响应和提问响应使用封闭的 `POST /api/v1/commands` HTTP Command API。每个命令同时携带 `commandId` 与 `Idempotency-Key`，Writer 在执行前写入 `runtime_commands` 账本；取消、交互和 read-state 各自在独立 lane 内保持 FIFO，因此不会排在未结束的 Prompt 后面。Prompt 不在 dispatcher 内按 Session 串行等待，而是立即进入 Session 级 `next batch`：当前 turn 运行期间的用户、Agent 和平台输入按项目上下文冻结为一次后续 ACP Prompt，每条输入仍独立持久化，稳定 dedupe key 会折叠重试通知。Prompt 返回 `202 accepted`，短命令等待完成后返回 `200`。API 重启按 `(created_at, command_id)` 游标分页读取全部 accepted/running 命令，不受单页 1000 条上限影响；已落用户消息的 running Prompt 会标记 interrupted，禁止重复发送。`VITE_COMMAND_TRANSPORT=ws` 是 PC 显式回滚开关，移动端和访客链路仍使用 WS 兼容命令。

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

每个 Session actor 在一次所有权周期内使用固定 `streamGeneration`，只在实际输出逻辑 patch 时递增 `sequence`。文本 delta 按 message 合并，process item 采用 latest-wins；权限、elicitation 和 done 会先 flush 同 Session 的普通更新。Runtime 的可见流每 25ms 通过独立本机管道直达 Realtime，API 事件循环阻塞不会中断浏览器流式输出；持久化流以 250ms 节奏发送到 API，并带同一 Session 游标。文件工具的可见更新只携带路径，不向浏览器复制 `oldText` / `newText` 完整 diff；原始 diff 只进入持久化通道。可见流是游标的唯一分配者：持久化 flush 必须先完成对应 UI flush，再复用该 patch 已发布的游标，不能为仅写数据库的更新生成浏览器不可见的 sequence。

持久化批次在开始异步发送前冻结该批全部可见流游标，慢速写入不能读取或删除后续同 key 更新的新游标。单个 Session 的持久化回调失败会在 API 侧记录并隔离，失败写链不会阻止该 Session 后续清理或恢复，也不会重启共享 Runtime；只有 Runtime 进程自身异常退出才进入监督重启边界。Runtime 重启期间，尚未进入 IPC 的新请求有界等待下一 generation，已经发送的 Prompt 明确失败且不会自动重放。

Runtime done 是持久化屏障，不直接对浏览器发布。API 按 Session 顺序处理持久化 patch，触发 `session:done`，等待 Writer 完成 `message.done + Outbox` 原子事务后才向 Runtime 返回 ack；随后 `session:committed_done` 才进入 Realtime。Runtime 意外退出时 API、HTTP、Query/Writer Worker 和 Realtime 保持运行，当前命令明确失败并由 Session 主链路落一条 error completion；监督器重启 Runtime，下一轮从 SQLite 快照和 `acp_session_id` 恢复。`RUNTIME_SERVICE_MODE=embedded` 保留旧 `acpHost` 作为显式回滚适配器，不会在运行中静默降级。

process Runtime 使用 API 投影到快照中的 HTTP MCP 配置调用平台工具。ToolRegistry、工具上下文、审计和业务写入仍由 API 进程所有；Runtime 与 Claude/Codex 子进程不打开平台数据库。相同 Session 上下文与可见工具集合复用同一 bearer token，项目、团队、Agent 或工具可见性变化时撤销旧 token 并生成新 token。embedded 回滚模式仍可使用 stdio 工具网关，不改变 process 模式的所有权边界。

Runtime 为每个活动 turn 保存原始 `messageId`、`turnId` 和 stream generation。取消先请求 ACP cancel；未在宽限时间内终止时只关闭目标 ACP Session，仍未终止才重启所属 Agent。每次升级都会 fence 旧 generation，迟到输出不能进入下一轮；终态只使用原 turn identity 发布一次 `cancelled` done。API 不再清理本地 active 状态或伪造 `cancel-timeout-*` done，`session.cancel` 的 HTTP 200 表示 Runtime 已返回 `requested`、`not-active` 或明确失败。

Runtime 资源配额默认允许 32 个网络型 turn、`max(2, floor(cpuCount / 2))` 个 CPU 型终端和 2 个磁盘型终端。等待队列按 FIFO 唤醒；Session mailbox 同时受条目数和字节数限制，超过上限返回 `RUNTIME_BACKPRESSURE`，不会丢弃已经接受的关键工作。

Runtime 子进程分别记录 Agent 与 Session 的最近活动时间。周期 sweep 只回收没有活动 actor、没有待处理 permission/elicitation 的空闲 Session。能力查询和配置产生的空 Session 只保留在 Runtime 内存，模型与模式偏好单独持久化；第一次真实 Prompt 才保存 `acp_session_id`。已有原生历史的 Session 保留该 ID 并在下次发送时 resume。空 Session 的原生 ID 缺失时可在 Prompt 前重建一次；已有历史的 Session 禁止静默重建，避免模型上下文与平台历史不一致。Agent 没有已连接 Session 且继续空闲后才停止 ACP 子进程。`RUNTIME_SESSION_IDLE_MS`、`RUNTIME_AGENT_IDLE_MS` 和 `RUNTIME_IDLE_SWEEP_MS` 分别控制两级阈值与扫描周期；停机时会先停止定时器并等待正在执行的 sweep。

Runtime 的 permission/elicitation 等待项由独立交互状态模块管理。超时、取消、Session unbind、Agent 退出或 Runtime 关闭都会先发布取消型 result，再解除 ACP Promise，保证 Realtime 和持久化状态同步清除卡片。Recovery 只恢复最新 `message.done` 之后的交互事件，已结束 turn 的历史请求不会重新阻塞输入；ACP 确认 Claude `bypassPermissions` 或 Codex `agent-full-access` 已生效后，Runtime 还会在 permission callback 边界优先用单次授权自动放行，避免 adapter 再次请求审批，同时不会把尚未生效的偏好误当作 full-access。

### Realtime 进程边界

默认 `REALTIME_MODE=process` 时，独立 Realtime 子进程独占浏览器 WebSocket、认证握手、Session 订阅索引、JSON 序列化和发送背压；API 进程不持有浏览器 socket。两者通过本机 named pipe（Windows）或 Unix domain socket 通信，消息使用 4 字节大端长度前缀和版本化 Protobuf envelope，业务 payload 为受类型约束的 UTF-8 JSON。Envelope 携带 `version`、`kind`、请求/会话/流游标和幂等元数据，单帧大小受 `REALTIME_IPC_MAX_FRAME_BYTES` 限制。

浏览器先请求 `GET /api/v1/realtime-config` 获取实际 `wsUrl`、协议版本、运行模式和兼容桥状态。Edge 模式返回当前公网 authority 的同源 `/realtime`，不会泄露内部端口；PC 与移动端每次重连都重新发现端点。PC 每 15 秒发送一次 `ping`，连续 30 秒没有收到任何入站帧时主动关闭静默失效的 socket 并重新发现端点；重连后仍先恢复订阅，再发送 cursor `resume`，最后通过 HTTP recovery 补齐状态。`EDGE_MODE=disabled` 时 discovery 返回直连 Realtime 地址。`REALTIME_MODE=embedded` 是显式回滚模式；`REALTIME_LEGACY_RPC=enabled` 保留尚未迁移到 HTTP 的旧领域 RPC，关闭后 Realtime 只接受 `subscribe`、`unsubscribe`、`resume` 和 `ping`。

Android App 的“后台实时语音”只在客户端启用：设置页保存项目/Agent/Session，原生 Foreground Service 使用系统 SpeechRecognizer、TextToSpeech 和蓝牙通信音频路由；音频路由独立记录为蓝牙、有线耳机、手机扬声器或未知，蓝牙权限/路由失败不会阻断手机扬声器回退；Android 11+ 通过包可见性声明发现系统语音服务。它复用上述 Realtime 订阅、Prompt、心跳、游标恢复和重同步协议，不改变 API、数据库或 Runtime 边界。
当系统没有可用 `RecognitionService` 时，Foreground Service 改用 `AudioRecord` 采集 16 kHz 单声道 PCM，并用本地语音活动检测划分单轮话语。音频通过同源、受本地 Token 保护的 `/api/v1/voice/asr` WebSocket 到达 API Gateway，再代理到仅后端可见的 `FUNASR_WS_URL`；最终转写继续复用原有 Prompt 路径。Edge 只将该 WebSocket 路径转发给 API，其余 Upgrade 仍转发给 Realtime。

每个连接有独立的消息数和字节数上限。文本 delta 按消息合并，process item 采用 latest-wins，`session:done`、权限/提问和错误保持关键 FIFO；客户端跟不上、序列跳号或 generation 变化时发送 `resync_required`，由客户端重新读取 HTTP snapshot。发生 gap 后，Realtime 先排入 `resync_required`，仍允许后续关键 `session:done` 按序送达；PC 收到 resync 后先解除增量屏障，再执行 Session recovery 和项目后台刷新，避免恢复请求期间继续丢弃终态。Realtime 分别跟踪“已接收入站 cursor”和“已发送 cursor”，在前一帧仍 in-flight 时不会把连续的新帧误判为 gap。一个慢客户端只消耗自己的有界队列，不能拖住其他连接。API 进程监督 Realtime 异常退出并自动重启；HTTP、Query Worker 和 Writer Worker 在重启期间继续服务。

### SQLite Worker 边界

应用启动时先完成 schema migration、旧 JSON 导入和内置数据 seed，再启动一个 Query Worker 和一个 Writer Worker。Query Worker 只读；Writer Worker 的新写路径按 `critical / interactive / background` 排队。Background 最多等待 25ms，并在达到 100 个 mutation 或 256KiB 时提前提交；critical 先提交同一 Session 已排队的 background mutation，再单独提交。文件工具产生的行级 diff 由惰性启动的 File-change Worker 使用 Myers 算法计算；同一工具的 running 更新只保留最新版本，终态先 drain 已接受的 diff，再由 Writer 聚合消息级摘要，因此 API 主线程不执行行级 diff，也不会在终态重复计算。

Session 流式事件、running message snapshot、Turn Process 高频更新和 Session 终态已通过 `WriteDataPort` 进入 Writer Worker。API 为每个 Session 串行提交 Turn Process 写入；终态提交前先 drain 已接受的过程更新，再用 critical mutation 原子完成过程项、Agent 消息、文件变更汇总、Session stage 和时间戳。每个活动 Session 使用 `streamGeneration + sequence` 排序，重试通过 `batchId` 去重。`message.done` 与 Outbox 在同一事务提交，Gateway 只在 commit ack 后广播线上的 `session:done`。因此浏览器收到完成事件时，HTTP Snapshot 已可读取最终持久化状态。

`WriteDataPort` 是后续迁移其他写接口的复用边界：业务模块只新增封闭、类型化 mutation，Writer 侧实现对应事务操作，即可复用现有优先级调度、同 Session 顺序、`batchId` 幂等、超时对账、慢请求日志和 Worker 生命周期。禁止通过该端口传任意 SQL；仍留在兼容 Store 的低频写接口按风险和收益逐步迁移。

API 领域 Command、工具和部分同步状态修改仍使用兼容 Store 连接。`tests/unit/database-access-boundary.test.ts` 锁定主线程直接 `getDb()` 的兼容清单，清单只能缩小；`tests/unit/runtime-boundary.test.ts` 锁定 Runtime 子进程的反向依赖禁令。`DATA_WORKER_MODE=local` 是显式故障回退开关，不会在 Worker 崩溃后自动降级到同步 SQL。

Query/Writer Worker 的完成日志包含优先级、队列深度、排队时间、执行时间、Worker 总耗时、API 客户端观察耗时、响应投递延迟和载荷字节数。`DATA_WORKER_SLOW_MS` 配置慢请求阈值，默认 100ms；慢请求按 `worker_execution`、`worker_queue` 或 `api_delivery` 明确分类，避免把 Worker 已完成但 API 未及时处理回调误判为 SQL 缓慢。客户端超时后会短期保留有界的请求诊断信息；若 Worker 响应随后到达，会记录迟到响应及对应 operation，不会重新完成已经超时的调用。

HTTP Query 路由分别记录 Worker 查询、JSON 序列化与完整请求耗时，并通过 `Server-Timing` 返回阶段指标。Recovery 查询额外记录 sequence 与 event materialization 的分段耗时和事件数量。仍留在兼容 Store 的 API 同步写操作通过 `src/store/db-operation-observer.ts` 记录具名操作、连接角色、耗时和 SQLite 错误码。所有诊断日志只包含安全业务标识和规模指标，不记录 SQL 参数、消息正文、附件、Token 或密钥。

API 进程使用 `src/shared/operation-diagnostics.ts` 保存有界、纯内存的操作快照。异步操作只表示当前仍在等待的逻辑入口；同步操作记录稳定的 `operationModule + operation`、安全业务标识和耗时。RPC、HTTP Command、HTTP Query、工具执行、规则执行和已接入 `db-operation-observer` 的主线程写操作共享该命名机制。Event-loop 告警同时附带 active operations 与当前采样窗口内最慢的同步操作，采样后清空同步窗口；诊断信息不会进入业务响应或数据库。

历史明细保留由 `src/data-retention/` 统一调度，并且只通过 Writer Port 执行。每个 Session 永久保留 `messages` 事实和最新 15 个成功 Agent 回合的完整过程；超过 7 天且位于第 16 个及更早的成功回合，只分批删除对应 `turn_process_items` 与 `session_events`。清理工作以 Writer `background` 优先级单独成批，每批最多处理 500 行，事务内重新校验候选消息，进程中断后从永久保留的 `messages` 重新计算，不依赖清理游标或任务表。

定时窗口为北京时间 02:00-06:00，服务在窗口内启动时延迟一分钟开始，持续运行的服务会在 02:00 自动触发。`DATA_RETENTION_MODE=off|dry-run|delete` 控制定时行为；本机 CLI 通过数据目录内自动生成的清理控制令牌访问管理 API，提供 dry-run、启动删除、状态查询和停止控制，令牌不会进入数据库或普通前端。清理后的历史消息仍从 `file_changes_json` 返回文件级变更摘要，但不再提供逐段 Diff、思考过程或工具详情。

Writer 独占 SQLite 维护。周期任务先 drain 写调度器，只删除超过保留期且 `published_at IS NOT NULL` 的 Outbox，运行 `PRAGMA optimize`，并在 WAL 达到 64 MiB 时执行 PASSIVE checkpoint；正常停机在 Session persistence flush 后执行 TRUNCATE checkpoint。未发布 Outbox、messages 和 session_events 永不由维护任务删除。

Edge、API、Realtime、Runtime 各自使用 `monitorEventLoopDelay` 和 event-loop utilization，每 30 秒记录 p50/p95/p99/max lag、RSS/heap，以及本进程的代理连接、active prompt、连接/订阅/发送队列或 Runtime actor/coalescer backlog。p99 达到 `EVENT_LOOP_WARN_THRESHOLD_MS` 或单次 max 达到 `EVENT_LOOP_MAX_WARN_THRESHOLD_MS` 都会告警，避免孤立的长阻塞被 p99 稀释。

`session:activity` 是独立的轻量全局事件，只表示会话本轮执行从 `running` 到 `idle` 的状态变化，用于左侧会话列表运行中/未读提示；它不承载聊天内容，也不参与历史消息还原。

桌面悬浮 Widget 也使用 `session:activity`，但不订阅完整 `session:update` 聊天流。Widget 是固定 300x400 的紧凑窗口，保存带尺寸版本的 bounds 并在升级时维持最近屏幕边缘的间距；亮色、黄色和深色主题由单一按钮循环并保存在 renderer localStorage。Widget 通过 `widget.sessionActivity.list` 获取 Session 级轻量 DTO：共享 Session 投影通过 `QueryPort` 在只读 Query Worker 中执行，完成时间以已结束 Agent 消息为事实源，不扫描高频 `session_events`。后端按 Agent 与 Project 分组，保留每个正在执行、未读或直接关联 Task 处于 `needs_input`/`blocked` 的普通对话 Session；`purpose=autonomy` 的自主运行 Session 不进入 Widget 聚合。Task 只通过 `sessions.task_id` 或 `task_steps.session_id` 的直接关系关联，禁止把 Agent 的其他 Task 挂到当前 Session。每个 Session 固定单行显示状态、会话标题、任务标题和右侧紧凑时间，Session 内容从 Agent 图标下方开始以减少窄窗口左侧空白；底部状态按钮在全部、运行中、待处理和未读之间循环筛选。Widget 将短时间内的 Agent、Session 与 Task 事件合并为一次刷新；同一时刻只允许一个活动请求，期间的新事件只触发一次后续刷新。点击 Session 时通过桌面内部路由打开 `/p/:projectId/workspace?sessionId=...`，主进程接受导航请求后仅确认该 Session 已读。旧的 Agent 代表会话和 Session 列表 RPC 继续保留用于兼容，但同样排除自主运行 Session。


### 创建任务

```text
Web UI → WS "tasks.create" → ws-handler → gateway/rpc/tasks
  → taskManager.createTask() / taskStore.create()
  → mitt "task:update" → ws-handler 广播 → Web UI / 其他订阅方
```

协作任务由 `tasks.create` 创建 draft 空壳，再通过 `tasks.step.*` 编排步骤并由 `tasks.start` 派发。简单任务走 `tasks.createSimple`，后端复用 `core/task-simple.ts` 创建默认 step 并立即派发。Agent 对话任务化的 MCP 入口使用 `studio.task.create(selfExecute=true)`，由 `taskManager.createTask()` 创建默认 step 并仅跳过该默认 step 的初始 prompt 注入；后续新增的 ready step 仍由 `step-dispatch` 注入步骤 prompt。任务有步骤图时，`studio.task.assign` 只记录 Agent 与默认执行会话，必须继续调用 `studio.task.start`，避免重复发送整任务 prompt。任务步骤派发使用 `PromptIntent` 元数据和稳定 dedupe key：ready 步骤先通过原子 claim 进入 running，Session 队列在真正发送 ACP 前由 task-step validator 重新读取任务/步骤状态，已完成、已取消或已失效的排队 Prompt 会被跳过；已 claim 的执行单元不会因为任务图短暂回退为 draft 而被误取消。该校验边界不改变用户、定时任务或 Agent 消息的通用入队行为。任务 prompt 文本构造集中在 `core/task-prompt.ts`，避免任务生命周期逻辑与长模板耦合。

任务看板和 Workspace 右侧列表使用 Task summary read model，只携带状态、步骤摘要、最新汇报预览和 `descriptionPreview`。Workspace 的今日与历史列表使用相互独立的分页状态，历史滚动到底后按 Task ID 游标继续加载；重连或 `resync_required` 会重新读取两类首屏恢复事实状态。TaskBoard 作为兼容入口在打开时显式读取完整项目任务。打开任务详情后，前端详情缓存通过 `tasks.get` 读取完整正文；详情请求有独立的 loading/error/retry 状态，不会把摘要误当成完整任务目标。

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
| `src/runtime/` | 独立 Runtime 服务、API 适配器、Session actor、流合并与资源配额 | `service/*`、`api/process-runtime-port.ts`、`api/process-runtime-support.ts`、`actors/session-actor.ts`、`streams/runtime-update-coalescer.ts`、`streams/runtime-update-cursor-store.ts` |
| `src/core/` | 业务逻辑 | `sessions.ts`、`session-prompt-batcher.ts`、`session-runtime-control.ts`、`turn-process-runtime.ts`、`platform-presentation-results.ts`、`prompt-diagnostics.ts`、`session-event-payload.ts`、`tasks.ts`、`task-simple.ts`、`task-prompt.ts`、`task-steps.ts`、`projects.ts`、`agents.ts`、`teams.ts`、`event-center.ts`、`events.ts`、`knowledge-base.ts` |
| `src/ports/`、`src/queries/` | 异步查询边界与当前单体适配器 | `query-port.ts`、`local-query-port.ts`、`task-list-query.ts` |
| `src/gateway/` | API 对外接口与 Realtime 桥 | `server.ts`、`reading-assets.ts`、`http/query-routes.ts`、`http/realtime-config-route.ts`、`realtime-event-source.ts`、`realtime-rpc-bridge.ts`、`ws-handler.ts` |
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

`project-data-scope` 是项目切换的前端编排边界。路由项目变化时，它每次都同步激活各 Zustand store 的项目分区缓存，再发起后台刷新；同一项目的并发导航只合并网络刷新，不合并 Store 激活，因此 A → B → A 快速切换不会把 B 的投影留在 A 页面。公共激活不预取完整 Task 列表：Workspace 自主管理项目/时间/完成筛选分页，TaskBoard 和 Dashboard 在页面入口显式请求兼容完整列表。Agent、Session 列表、文件树、规则、知识库、事件中心和 Agent Memory 均按项目或更细的 Agent/维度 scope 缓存；缓存采用 30 秒 stale-while-revalidate、逐 scope 请求序号和 LRU 淘汰，迟到响应只能写回自身 scope，不能覆盖当前项目投影。Agent、Session 和消息的首次加载显式区分加载中、失败可重试和真实空列表。

WebSocket 实体更新按实体携带的 `project_id` 写入目标缓存。只包含实体 ID 的局部更新会修改所有命中的已访问 scope；无法安全合并的集合更新只标记目标 scope 失效，并仅刷新当前可见项目。Session 的消息、事件和流式执行状态继续按 `sessionId` 使用既有缓存，不复制到项目列表缓存。

PC Session store 对取消维护独立的 stopping 状态。首次点击立即显示“正在停止”，同一活动 turn 的重复点击复用同一 Command ID 和 in-flight Promise；取消失败保留 running 并暴露错误，`session:done` 或 idle activity 清理 stopping。用户可以在 stopping 期间编辑下一条消息，该 Prompt 等待取消 Promise 完成并只在 HTTP 202 accepted 后清空草稿和图片。Workspace 与全局助理遵循同一规则。

项目视图状态与业务数据缓存分离。每个项目独立保存 Workspace 侧栏与 Agent 选择、任务选中项和滚动位置、知识库搜索及未保存草稿、事件中心 Tab、Agent Memory 的 Agent/维度选择。低频选择状态持久化到浏览器存储，滚动位置只保存在内存；删除项目时路由记忆、视图状态、资源缓存和最后会话映射一并清理。

Session、Agent 和当前项目的运行中/未读提示使用同一个 Session 指示器汇总函数，且运行中优先于未读，避免三层展示出现不同计数。当前项目直接覆盖为本地 Session store 的实时汇总；后台项目保留 `sessions.projectStats` 的轻量全项目快照。该查询聚合 active、非删除、非归档、非模板会话，并把 SQLite 中的运行信号与进程内 active prompt 合并；PC stats store 在全局会话事件后更新，并以 30 秒 stale interval、页面重新可见和窗口 focus 作为恢复边界。移动端项目和 Agent 的展示顺序只使用创建顺序与后端 Agent 顺序，不会因未读或运行状态变化而重排。打开具体会话通过 `sessions.markRead` 持久化 `last_read_at`；当前可见 Session 在最终消息完成后再次确认已读，后台完成则保留未读直到页面重新可见，点击项目本身不会批量清除未读。用户显式调用 `sessions.markUnread` 时，`marked_unread` 事件优先于“当前会话自动已读”规则；PC 清除当前 Session 选择，移动端返回来源页，下一次进入后再恢复自动已读。

PC 右侧全局栏同时承载全局助理和置顶会话快捷入口，两个抽屉互斥；PC 另有独立 `/pinned` 页签，会话标题栏按“分享、置顶、标记未读、时间线”提供一级操作。移动端底部“动态”使用 `widget.sessionActivity.list` 跨项目读取运行中或未读 Session，“会话”仍以当前项目和 Agent 组织普通 Session，并通过 `/?view=pinned` 在同一入口切换跨项目置顶列表；旧 `/pinned` 地址只做兼容重定向。移动端聊天输入区在发送/停止按钮右侧提供 `+`，展开区只承载当前会话的置顶和标记未读。置顶会话通过 `global_session_dock` 保存跨项目普通 Session 的引用与顺序，使用独立轻量读模型汇总项目、Agent、运行态、未读和最近活动，不加载消息历史，也不修改 Workspace Session store。增加、移除和排序发布 `session-dock:update`；客户端还在相关 `session:activity`、`session:done`、`session:changed` 及重连后校准列表。点击条目导航到 `/p/:projectId/workspace?sessionId=...`（移动端为 `/chat/:sessionId`），聊天仍由原会话主链路承载。

## 支持的 Agent 运行时

| 运行时 | 包 | 状态 |
|--------|-----|------|
| `mock` | 内置 | 可用（开发/测试） |
| `claude` | `@agentclientprotocol/claude-agent-acp` | 可用 |
| `codex` | `@agentclientprotocol/codex-acp` | 可用 |
| `gemini` | — | 未接入 |

## PC 会话动态工作台

PC 全局 `/updates` 是独立的会话动态工作台。左侧复用 `widget.sessionActivity.list` 与 `sessionDock.list` 聚合跨项目动态和置顶 Session；中间使用专用 Workbench Session store 按 `sessionId` 查询消息、订阅实时流和提交 Prompt，不修改 Workspace Session store；通用 `ConversationPane` 复用消息列表、执行过程懒加载、滚动锚定和 Workspace 风格 Composer，Composer 的文本、图片和文件草稿按 Session 隔离，并允许异步上传完成后回写已切走的目标 Session，过期图片预览会被回收。右侧从消息的 `presentations_json` 派生原型和文件清单，并通过 `fs.read` 按需读取正文。打开会话使用 `sessions.markRead`，重连后重新校准列表和当前会话。

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

项目级 Agent 可以在 `config_json.modelProfileId` 上绑定一个模型档案。模型连接拥有协议、Base URL、凭据和可选模型目录；模型档案按 runtime 区分 Claude Code 与 Codex，只保存默认模型、上下文窗口和显式填写的 runtime 模型项。有效配置按“Session 偏好 > Agent 模型档案 > Runtime 系统配置”解析；未绑定档案时不注入连接或模型覆盖，档案可选项留空时也保留本机 Claude Code / Codex 系统值。

Claude 档案通过进程环境和 Session settings 应用兼容 Anthropic 的连接，只覆盖明确配置的 Haiku、Sonnet、Opus 映射。Codex 档案在 ACP initialize 后使用 `gateway` 认证方法传递 OpenAI-compatible 连接，再通过 Session model 选择应用模型和可选 effort，不写入或替换用户的全局 `~/.codex` 文件。连接指纹只包含凭据哈希；Base URL 或 Key 改变时，Runtime 阻止该 Agent 的新 Session ensure，等待其现有 turn 全部结束后只替换该 Agent 进程，其他 Agent 和平台进程不受影响。Claude 档案还记录是否允许 Agent 主动读取图片；默认禁止时，Gateway 在 ACP Session 设置中注入图片 `Read` 权限规则，不影响用户随 Prompt 上传图片。Agent runtime 改变、档案删除或档案 runtime 改变时，后端会清理不再匹配的绑定。

详细流程见 `docs/architecture/project-agent-workflow.md`。

## Agent 会话通信

非 Team 场景下，Agent 通过 `agent.message.send` 向另一个 Agent 的 Session 发送平台消息；只指定 `targetAgentId` 时，后端创建新的目标 Session，不复用最新会话。消息来源的 `sourceAgentId`、`sourceSessionId` 和 `projectId` 由当前 MCP tool context 注入，业务关联信息统一放入 `relatedInfo` JSON。

投递链路不阻塞调用方整轮执行：后端先写入 `agent_session_messages`，再后台调用 `sessionManager.enqueuePrompt(targetSessionId, prompt)`。`needReply` 只表示目标 Agent 完成后应主动调用 `agent.message.send` 回到来源 Session；如果目标 Session 完成后仍未检测到反向消息，系统最多补发一次提醒。

`agent.watch.create` 记录一条 `agent_session_watches`，用于在被监听 Session 下一次 `session:done` 后唤醒 watcher 所在 Session。watch 默认只触发一次；如果被监听 Session 已经通过 `agent.message.send` 给 watcher 发过消息，watch 会标记触发但抑制重复 prompt。

## Team MCP 协作边界

Team 领域保留 `team.*` MCP handlers、工具记录、绑定和 Profile，但当前 Agent 暴露策略在 HTTP 与 stdio 两条 Runtime 路径统一过滤全部 `team.*`，Claude Code 与 Codex 均不可见。工具 handler 仍只校验 Team、Member、Task 与 Project 的一致性；未来恢复 Agent Team 能力时，可移除静态过滤并继续使用现有 Agent 级绑定或 Team Profile。

TeamMember 的 `session_id` 指向普通 `sessions` 行，成员执行输出继续落到 `messages` 和 `session_events`，所以刷新或切换会话后仍能按现有会话事件恢复。团队上下文通过 ToolContext 的 `teamId` / `teamMemberId` 传递，成员调用 `team.mailbox.send`、`team.task.update` 时不需要在 prompt 中手写 Team ID。`team.member.spawn` 创建或加入成员后，会自动给成员 Agent 套用 `team-member` Profile，让成员后续会话具备汇报和更新团队任务的基础工具。

前端工作台不为 Team 提供独立页面。`teams.current(sessionId)` 按当前会话反查 Team 上下文；右侧上下文区展示成员、任务和 mailbox，点击成员只切换到该成员的普通 Session。Team 变化通过 `team:update` 广播触发当前会话上下文刷新。

Team 运行时事件规则：`team.member.spawn` 会广播包含完整成员 Session 行的 `session:changed`，并为所属 Team 广播 `team:update`。`team.member.message` 携带 `taskId` 时，会把 `backlog/planning` 的 Team Task 推进到 `executing`，并同时广播 `task:update` 与 `team:update`。内部 Team MCP 权限自动放行仅限当前会话可见、且工具定义不需要审批的 `team.mailbox.send` 与 `team.task.update`。

## ACP 懒生命周期

- `sessions.create` 只创建本地 SQLite 行；在真正连接 session 前，`acp_session_id` 保持为空。
- 首次 `prompt`，或显式切换 model/mode/config 时，调用 `RuntimePort.ensureSession()` 启动 Agent runtime，并创建或恢复 ACP session。
- 同一个 Agent 可以同时保持多个 ACP session 连接；平台只拒绝同一个本地 Session 内的并发 turn。
- Runtime 关闭 Session 或进程时释放 ACP、终端和交互资源；已持久化 messages/events 和 `sessions.acp_session_id` 都会保留。
- Session 级 runtime preferences 保存在 `sessions.runtime_preferences_json`。API 把偏好放入快照，ACP session 创建、恢复、加载或 fork 后由 Runtime 恢复 model/mode/config。
- Claude 的 ACP fork 只保证当前进程内的新 Query 可用，不保证立即生成可跨进程恢复的目标 JSONL。Runtime 在 fork 返回后同步复制并校验源 JSONL 与同名伴随资源目录，原子发布目标快照后才注册 Session；物化失败会关闭新 Query 并向调用方返回失败。Codex 继续使用自身的 thread fork 持久化。
- 会话模板以已物化的 fork 作为不可变上下文快照。历史模板缺少快照时，只在源 Claude JSONL 仍存在的情况下按需修复；源快照也缺失时要求重新发布模板。删除模板会同时清理模板副本，不删除源会话文件。

## 全局模型档案策略

Claude Code 与 Codex 各自在 `settings` 中保存一个可选的全局模型档案 ID。Agent 通过 `config_json.modelProfileMode` 选择 `global`（跟随全局）、`fixed`（使用自身 `modelProfileId`）或 `system`（绕过档案并继承 Runtime 系统配置）。兼容旧数据时，有显式 `modelProfileId` 的 Agent 视为固定档案，未绑定档案的 Agent 视为跟随全局。

API 在每次发送 Prompt 前构建 Runtime Snapshot，因此全局切换不需要重启平台服务。已有 Session 级手动模型偏好比 Agent 档案更具体，会继续保持；没有 Session 覆盖时，Codex 仅模型或推理强度变化时复用进程并更新 Session 模型。Base URL、Key 等进程配置变化时沿用 Agent 指纹和空闲替换机制，只替换受影响的 Agent。Claude Code 的模型、上下文、图片权限或连接配置变化也在对应 Agent 空闲后替换其进程；其他 Agent 和正在执行的 turn 不受影响。

## 未实现的设计目标

以下在设计文档中有描述，但当前代码未实现：

- Memory/RAG 记忆系统
- 事件触发自动化执行（当前只有规则/定时管理）
- 插件系统


## Session Update Scheduling

`src/core/events.ts` keeps the public `session:update` event contract. Embedded updates and process Runtime persistence patches enter `SessionUpdateActorScheduler` before API consumers run; process Runtime visible patches have already been ordered and coalesced by the Runtime Session actor and travel directly to Realtime.

Scheduler output is emitted back through the internal mitt bus as the same `session:update` event, so `sessions.ts`, `turn-process-runtime.ts`, and `ws-handler.ts` continue to subscribe through the existing interface. Critical boundaries such as permission or elicitation prompts, lifecycle updates, usage/config/sessionInfo updates, terminal tool statuses, and `session:done` flush the matching session queue before persistence, finalization, or broadcast continues. Internal update envelopes also carry a source marker for runtime persistence versus platform reconciliation/synthetic completion; platform supplements update tool state without creating a new final-reply boundary.

## MCP Tool Context Boundary

Platform MCP tools use the session tool context as the source of truth for project, Team, member, current Agent, and session identity. Runtime schema sanitization hides system-owned fields from model-visible schemas, while handlers still validate business target IDs against the current project or Team before creating sessions, tasks, or Team records.
