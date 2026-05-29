# 系统架构总览

> 本文档描述 AI IDE Studio v0.2.0 的**当前真实架构**，随代码同步更新。

## 系统拓扑

```text
客户端层
  Web UI / CLI / 外部调用方
      │ WebSocket / HTTP / CLI
      ▼
Gateway 层
  server.ts       HTTP 服务与 WS 升级
  ws-handler.ts   WS 连接、订阅、广播、JSON 解析、RPC dispatch
  rpc/*           按领域拆分的 WS RPC handler
      │ mitt 事件总线
      ▼
Core 业务层
  sessions.ts / tasks.ts / projects.ts / agents.ts / teams.ts / events.ts
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
Web UI → WS "prompt" → ws-handler → gateway/rpc/subscriptions.prompt
  → sessionManager.sendPrompt() → acpHost.ensureSession() / acpHost.prompt()
  → Agent runtime 子进程 (stdio NDJSON)
  → ACP session/update → core events → ws-handler 广播 → Web UI 流式更新
  → session:done → messages 与 session_events 持久化到 SQLite
```

### 创建任务

```text
Web UI → WS "tasks.create" → ws-handler → gateway/rpc/tasks
  → taskManager.createTask() / taskStore.create()
  → mitt "task:update" → ws-handler 广播 → Web UI / 其他订阅方
```

### 管理 Session

```text
Web UI → WS "sessions.rename/delete/archive/close"
  → ws-handler → gateway/rpc/sessions → sessionManager
  → sessionStore 更新 title/status/archived_at/deleted_at
  → mitt "session:changed" → ws-handler 广播 → Web UI 更新左侧会话列表
```

Session 删除采用软删除，仅隐藏列表项并保留 `messages` / `session_events` 历史数据。项目工作台中的 `agents.list`、`sessions.list`、`tasks.list`、`sessions.create`、`tasks.create` 均应传递当前 `projectId`，避免跨项目混用 Agent、Task 和 Session。

## 目录功能映射

| 目录 | 职责 | 核心文件 |
|------|------|----------|
| `src/acp/` | ACP 协议集成 | `host.ts`、`client-handler.ts`、`host-state.ts`、`interaction-state.ts`、`terminal-bridge.ts`、`session-capabilities.ts`、`adapters.ts`、`capabilities.ts`、`update-mapper.ts` |
| `src/core/` | 业务逻辑 | `sessions.ts`、`tasks.ts`、`projects.ts`、`agents.ts`、`teams.ts`、`events.ts` |
| `src/gateway/` | 对外接口 | `server.ts`、`ws-handler.ts`、`rpc/*` |
| `src/store/` | 数据持久化 | `db.ts`、`migrator.ts`、`migrations/*`、各实体 store |
| `src/tools/` | 工具平台与 MCP 发布 | `resolver.ts`、`tool-gateway.ts`、`registry/*`、`runtime/*`、`mcp/http-mcp-server.ts` |
| `src/cli/` | 命令行工具 | `index.ts`、agents/sessions/tasks/rules 子命令 |
| `src/types/` | 类型定义 | `ws-protocol.ts` |
| `ui/src/pages/` | 页面组件 | Workspace/Dashboard/TaskBoard/Schedule/AgentSquare/ToolManager/Settings |
| `ui/src/stores/` | 前端状态 | Zustand store、`session-events.ts` 事件还原、项目/工具/模板/模型状态 |
| `ui/src/services/` | 通信层 | `ws-client.ts` |

## 支持的 Agent 运行时

| 运行时 | 包 | 状态 |
|--------|-----|------|
| `mock` | 内置 | 可用（开发/测试） |
| `claude` | `@agentclientprotocol/claude-agent-acp` | 可用 |
| `codex` | `@agentclientprotocol/codex-acp` | 可用 |
| `gemini` | — | 未接入 |

## 当前架构约束

- `projectId` 是项目级实体与项目内 Session/Task 的核心边界。
- `agent_templates` 是全局模板库；`agents` 是部署到具体项目后的运行时实例。
- Team 是项目级协作容器；TeamMember 绑定项目级 Agent 与当前团队 Session，Team Task 复用 `tasks.team_id`。
- `ws-handler.ts` 只负责 WS 连接、广播、JSON 解析和 dispatch；新增 RPC 必须放到 `src/gateway/rpc/*` 对应领域模块。
- SQLite schema 由 `src/store/migrator.ts` 与 `src/store/migrations/*` 管理；`db.ts` 不再承载大段建表/升级逻辑。
- ACP Host 对外暴露 `acpHost` facade；新增 runtime/session/client callback/terminal/interaction 能力优先下沉到专用模块。
- `tools` / `tool_bindings` / `skills` / `model_providers` 为全局可扩展能力表。
- MCP 工具平台目标架构见 `docs/architecture/mcp-tool-platform.md`，第一版按方法级可见性控制推进。
- ACP 对话生命周期、runtime/session/thread 对应关系与懒连接设计见 `docs/architecture/acp-session-lifecycle.md`。

## 项目级 Agent 边界

`agent_templates` 是全局模板库，类似工具箱；`agents` 是模板部署到具体项目后的运行时实例。项目工作台只展示当前 `projectId` 下的 Agent，Session、Task、文件浏览和工具上下文都沿用同一个项目边界。

创建或恢复 ACP Session 时，后端会从 Session 的 `project_id` 找到 Project，并把 `work_dir` 作为 ACP `cwd` 传给 runtime；同时按 `agentId/projectId/sessionId` 解析本轮可见的 MCP 工具。

详细流程见 `docs/architecture/project-agent-workflow.md`。

## Team MCP 协作边界

Team 能力通过 `team.*` MCP tools 暴露给 Agent。工具 handler 不判断 leader/member 权限，只校验 Team、Member、Task 与 Project 的一致性；谁能看到 `team.member.spawn`、`team.member.message` 等方法，仍由 MCP token 的 `visibleTools` 控制。

TeamMember 的 `session_id` 指向普通 `sessions` 行，成员执行输出继续落到 `messages` 和 `session_events`，所以刷新或切换会话后仍能按现有会话事件恢复。团队上下文通过 ToolContext 的 `teamId` / `teamMemberId` 传递，成员调用 `team.mailbox.send`、`team.task.update` 时不需要在 prompt 中手写 Team ID。

## ACP 懒生命周期

- `sessions.create` 只创建本地 SQLite 行；在真正连接 session 前，`acp_session_id` 保持为空。
- 首次 `prompt`，或显式切换 model/mode/config 时，调用 `acpHost.ensureSession()` 启动 Agent runtime，并创建或恢复 ACP session。
- 同一个 Agent 可以同时保持多个 ACP session 连接；平台只拒绝同一个本地 Session 内的并发 turn。
- 空闲回收分两层：先 close/disconnect 空闲 ACP session，再停止空闲 ACP runtime 进程。已持久化 messages/events 和 `sessions.acp_session_id` 都会保留。

## 未实现的设计目标

以下在设计文档中有描述，但当前代码未实现：

- Memory/RAG 记忆系统
- 事件触发自动化执行（当前只有规则/定时管理）
- 插件系统
