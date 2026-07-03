# 系统架构总览

> 本文档描述 AI IDE Studio v0.2.0 的**当前真实架构**，随代码同步更新。

## 系统拓扑

```text
客户端层
  Web UI / Mobile Web App / CLI / 外部调用方
      │ WebSocket / HTTP / CLI
      ▼
Gateway 层
  server.ts       HTTP 服务与 WS 升级
  ws-handler.ts   WS 连接、订阅、广播、JSON 解析、RPC dispatch
  rpc/*           按领域拆分的 WS RPC handler
      │ mitt 事件总线
      ▼
Core 业务层
  sessions.ts / tasks.ts / projects.ts / agents.ts / teams.ts / event-center.ts / events.ts / knowledge-base.ts
      │
      ├── Store 持久层
      │     db.ts                  SQLite 初始化、旧 JSON 导入
      │     migrator.ts            schema_migrations 执行器
      │     migrations/*           SQLite schema 迁移
      │     agents/sessions/tasks/teams/rules/tools/skills 等实体 CRUD
      │
      ├── ACP Host 层
      │     host.ts                 ACP facade 与生命周期编排
      │     client-handler.ts       ACP client callbacks
      │     host-state.ts           runtime/session 状态
      │     interaction-state.ts    权限确认与 Agent 提问等待队列
      │     terminal-bridge.ts      ACP terminal 桥接
      │     session-capabilities.ts 模型、模式、配置、MCP 能力合并
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
Web UI / Mobile Web App → WS "prompt" → ws-handler → gateway/rpc/subscriptions.prompt
  → sessionManager.sendPrompt() → acpHost.ensureSession() / acpHost.prompt()
  → Agent runtime 子进程 (stdio NDJSON)
  → ACP session/update → core events → ws-handler 广播 → Web UI 流式更新
  → session:done → messages / turn_process_items / session_events 持久化到 SQLite
```

前端实时对话以 `session:update` 作为可见流式状态来源；`session:event` 主要用于持久化同步、断线恢复和状态补偿，避免每个流式 chunk 都全量还原事件。后端在用户发送后立即创建一条 `messages.status = running` 的 Agent 消息，流式文本写入 `messages.content` 快照；思考、工具、权限、提问、计划和文件修改等执行过程写入 `turn_process_items`，并通过 `session:process_item` 轻量广播。完成后同一条 Agent 消息更新为 completed/failed/cancelled。

历史消息默认通过轻量 `sessions.messages` 加载，`messages.content` 是最终回复快速来源；历史执行过程通过 `sessions.messageProcess` 按需加载 `turn_process_items` 的轻量列表，单个过程详情再通过 `sessions.processItemDetail` 懒加载。旧数据仍可通过 `sessions.messageEvents` 从 `session_events.sequence` 兜底恢复；工具摘要/详情继续支持 `sessions.messageToolCalls` / `sessions.messageToolCallDetail`，文件修改详情优先从 `turn_process_items` 读取并兼容旧的 `tool_calls_json`。

`session:activity` 是独立的轻量全局事件，只表示会话本轮执行从 `running` 到 `idle` 的状态变化，用于左侧会话列表运行中/未读提示；它不承载聊天内容，也不参与历史消息还原。

桌面悬浮 Widget 也使用 `session:activity`，但不订阅完整 `session:update` 聊天流。Widget 通过 `widget.sessions.list` 获取会话优先的轻量 DTO：后端聚合 Session、Agent、Project、Task、运行态和已读状态，只把运行中或未读的 Session 暴露给小窗口。


### 创建任务

```text
Web UI → WS "tasks.create" → ws-handler → gateway/rpc/tasks
  → taskManager.createTask() / taskStore.create()
  → mitt "task:update" → ws-handler 广播 → Web UI / 其他订阅方
```

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
| `src/acp/` | ACP 协议集成 | `host.ts`、`client-handler.ts`、`host-state.ts`、`interaction-state.ts`、`terminal-bridge.ts`、`session-capabilities.ts`、`adapters.ts`、`capabilities.ts`、`update-mapper.ts` |
| `src/core/` | 业务逻辑 | `sessions.ts`、`turn-process-runtime.ts`、`prompt-diagnostics.ts`、`session-event-payload.ts`、`tasks.ts`、`projects.ts`、`agents.ts`、`teams.ts`、`event-center.ts`、`events.ts`、`knowledge-base.ts` |
| `src/gateway/` | 对外接口 | `server.ts`、`ws-handler.ts`、`rpc/*` |
| `src/store/` | 数据持久化 | `db.ts`、`migrator.ts`、`migrations/*`、`turn-process-items.ts`、各实体 store |
| `src/tools/` | 工具平台与 MCP 发布 | `resolver.ts`、`tool-gateway.ts`、`registry/*`、`runtime/*`、`mcp/http-mcp-server.ts` |
| `src/cli/` | 命令行工具 | `index.ts`、agents/sessions/tasks/rules 子命令 |
| `src/types/` | 类型定义 | `ws-protocol.ts` |
| `ui/src/pages/` | PC 端页面组件 | Workspace/Dashboard/TaskBoard/Schedule/EventCenter/AgentSquare/ToolManager/Settings |
| `ui/src/stores/` | 前端状态 | Zustand store、`session-events.ts` 事件还原、项目/工具/模板/模型状态 |
| `ui/src/services/` | 通信层 | `ws-client.ts` |
| `mobile/src/` | 移动端 Web App | `/app/` 下的手机端页面、组件和 Zustand store；复用 `ui/src/services/ws-client.ts` 与会话事件还原辅助逻辑 |

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
- `ws-handler.ts` 只负责 WS 连接、广播、JSON 解析和 dispatch；新增 RPC 必须放到 `src/gateway/rpc/*` 对应领域模块。
- SQLite schema 由 `src/store/migrator.ts` 与 `src/store/migrations/*` 管理；`db.ts` 不再承载大段建表/升级逻辑。
- ACP Host 对外暴露 `acpHost` facade；新增 runtime/session/client callback/terminal/interaction 能力优先下沉到专用模块。
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
- 首次 `prompt`，或显式切换 model/mode/config 时，调用 `acpHost.ensureSession()` 启动 Agent runtime，并创建或恢复 ACP session。
- 同一个 Agent 可以同时保持多个 ACP session 连接；平台只拒绝同一个本地 Session 内的并发 turn。
- 空闲回收分两层：先 close/disconnect 空闲 ACP session，再停止空闲 ACP runtime 进程。已持久化 messages/events 和 `sessions.acp_session_id` 都会保留。
- Session 级 runtime preferences 保存在 `sessions.runtime_preferences_json`。ACP session 创建、恢复、加载或 fork 后，host 会在能力列表可用时恢复保存的 model/mode/config；没有保存 mode 时，Codex 默认请求 `agent-full-access`，Claude Code 默认请求 `bypassPermissions`，不可用时保留 runtime 实际返回值。

## 未实现的设计目标

以下在设计文档中有描述，但当前代码未实现：

- Memory/RAG 记忆系统
- 事件触发自动化执行（当前只有规则/定时管理）
- 插件系统


## MCP Tool Context Boundary

Platform MCP tools use the session tool context as the source of truth for project, Team, member, current Agent, and session identity. Runtime schema sanitization hides system-owned fields from model-visible schemas, while handlers still validate business target IDs against the current project or Team before creating sessions, tasks, or Team records.
