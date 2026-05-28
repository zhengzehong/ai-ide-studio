# 系统架构总览

> 本文档描述 AI IDE Studio v0.2.0 的**当前真实架构**，随代码同步更新。

## 系统拓扑

```
┌─────────────────────────────────────────────────────┐
│                    客户端层                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Web UI   │  │  CLI     │  │ 外部 API │          │
│  │ (React)  │  │(commander)│  │  调用方  │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │ WS           │ 直连        │ HTTP            │
└───────┼──────────────┼─────────────┼────────────────┘
        │              │             │
┌───────▼──────────────▼─────────────▼────────────────┐
│                  Gateway 层                          │
│  ┌────────────────────────────────────────────┐     │
│  │  Hono HTTP Server (:18800)                 │     │
│  │  ├─ /api/health                            │     │
│  │  └─ WebSocket 升级 → ws-handler.ts         │     │
│  └────────────────────────────────────────────┘     │
└───────┬──────────────────────────────────────────────┘
        │ mitt 事件总线
┌───────▼──────────────────────────────────────────────┐
│                   Core 业务层                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ sessions │  │  tasks   │  │  rules   │          │
│  │  .ts     │  │  .ts     │  │  .ts     │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │             │                 │
│  ┌────▼──────────────▼─────────────▼─────┐          │
│  │         事件总线 (events.ts)           │          │
│  └────┬──────────────────────────────────┘          │
└───────┼──────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────┐
│                   ACP Host 层                        │
│  ┌────────────────────────────────────────────┐     │
│  │  host.ts — ACP 协议编排                    │     │
│  │  ├─ newSession() → 创建 ACP 会话           │     │
│  │  ├─ resumeSession() → 恢复 ACP 会话        │     │
│  │  ├─ forkSession() → Fork ACP 会话          │     │
│  │  ├─ prompt()     → 发送消息给 Agent        │     │
│  │  ├─ setModel()   → 切换模型                │     │
│  │  ├─ setMode()    → 切换模式                │     │
│  │  └─ setConfig()  → 切换会话配置            │     │
│  └────┬───────────────────────────────────────┘     │
│       │ 子进程 stdio (NDJSON)                        │
│  ┌────▼───────────────────────────────────────┐     │
│  │  Agent 运行时                               │     │
│  │  ├─ mock   (内置模拟)                       │     │
│  │  ├─ claude (claude-agent-acp)               │     │
│  │  └─ codex  (codex-acp)                      │     │
│  └────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────┐
│                  持久层                               │
│  ┌────────────────────────────────────────────┐     │
│  │  SQLite (better-sqlite3)                   │     │
│  │  data/ai-ide.sqlite                        │     │
│  │  ├─ agents          │  ├─ sessions         │     │
│  │  ├─ tasks           │  ├─ messages         │     │
│  │  ├─ session_events  │  ├─ task_events      │     │
│  │  ├─ projects        │  ├─ agent_templates  │     │
│  │  ├─ tools           │  ├─ tool_bindings    │     │
│  │  ├─ model_providers │  ├─ skills           │     │
│  │  └─ skill_bindings  │  └─ rules            │     │
│  └────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

## 数据流

### 用户发送消息

```
Web UI → WS "prompt" → ws-handler → sessionManager.sendPrompt()
  → acpHost.prompt() → Agent 子进程 (stdio)
  → 流式回传 session:update 事件 → mitt → ws-handler 广播 → Web UI 更新
  → session:done → 消息持久化到 SQLite
```

### 创建任务

```
Web UI → WS "tasks.create" → ws-handler → taskStore.create()
  → mitt "task:update" → ws-handler 广播 → Web UI / 其他订阅方
```

### 管理 Session

```
Web UI → WS "sessions.rename/delete/archive/close"
  → ws-handler → sessionManager
  → sessionStore 更新 title/status/archived_at/deleted_at
  → mitt "session:changed" → ws-handler 广播 → Web UI 更新左侧会话列表
```

Session 删除采用软删除，仅隐藏列表项并保留 `messages` / `session_events` 历史数据。项目工作台中的 `agents.list`、`sessions.list`、`tasks.list`、`sessions.create`、`tasks.create` 均应传递当前 `projectId`，避免跨项目混用 Agent、Task 和 Session。

## 目录功能映射

| 目录 | 职责 | 核心文件 |
|------|------|----------|
| `src/acp/` | ACP 协议集成 | `host.ts`（协议编排）、`adapters.ts`（运行时适配）、`capabilities.ts`（能力合并）、`update-mapper.ts`（事件映射） |
| `src/core/` | 业务逻辑 | `sessions.ts`、`tasks.ts`、`projects.ts`、`events.ts` |
| `src/gateway/` | 对外接口 | `ws-handler.ts`（WS RPC）、`server.ts`（HTTP） |
| `src/store/` | 数据持久化 | `db.ts`（初始化/迁移）、projects/agent_templates/tools/skills/model_providers 等实体 CRUD |
| `src/cli/` | 命令行工具 | `index.ts`（agents/sessions/tasks/rules） |
| `src/types/` | 类型定义 | `ws-protocol.ts`（WS 消息接口） |
| `src/tools/registry/` | 工具可见性与 token 上下文 | `visibility-resolver.ts`、`context-registry.ts` |
| `src/tools/runtime/` | 工具执行与审计 | `tool-runtime.ts`、`audit-service.ts` |
| `src/tools/mcp/` | MCP 协议入口 | `http-mcp-server.ts`（`/mcp` HTTP MCP） |
| `ui/src/pages/` | 页面组件 | Workspace/Dashboard/TaskBoard/Schedule/AgentSquare/ToolManager/Settings |
| `ui/src/stores/` | 前端状态 | Zustand store + session-events 事件还原 + 项目/工具/模板/模型状态 |
| `ui/src/services/` | 通信层 | `ws-client.ts`（WS 客户端） |

## 支持的 Agent 运行时

| 运行时 | 包 | 状态 |
|--------|-----|------|
| `mock` | 内置 | ✅ 可用（开发/测试） |
| `claude` | `@agentclientprotocol/claude-agent-acp` | ✅ 可用 |
| `codex` | `@agentclientprotocol/codex-acp` | ✅ 可用 |
| `gemini` | — | ❌ 未接入 |

## 当前架构约束

- `projectId` 是项目级实体与项目内 Session/Task 的核心边界。
- `agent_templates` 是全局模板库；`agents` 是部署到具体项目后的运行时实例。
- `tools` / `tool_bindings` / `skills` / `model_providers` 为全局可扩展能力表。
- MCP 工具平台目标架构见 `docs/architecture/mcp-tool-platform.md`，第一版按方法级可见性控制推进。
- `ws-handler.ts` 仍然承担总路由，但新增 RPC 应优先向领域模块下沉，避免继续膨胀。
- ACP 对话生命周期、runtime/session/thread 对应关系与懒连接设计见 `docs/architecture/acp-session-lifecycle.md`。

## 未实现的设计目标

以下在设计文档中有描述，但当前代码未实现：

- Memory/RAG 记忆系统
- 多 Agent 协作引擎
- 事件触发自动化执行（当前只有规则/定时管理）
- 插件系统


## ????????

Agent ?????????`agent_templates` ??????`agents` ???????????????????????????? Agent ????????????????????? Session ???

?????? `agents.list(projectId)` ??????? Agent????????????????????? Agent ???Session ?????? `projectId`???????? `work_dir` ?? ACP cwd??? `agentId/projectId/sessionId` ?? MCP ??????

????? `docs/architecture/project-agent-workflow.md`?


## ACP 懒生命周期

- `sessions.create` 只创建本地 SQLite 行；在真正连接 session 前，`acp_session_id` 保持为空。
- 首次 `prompt`，或显式切换 model/mode/config 时，调用 `acpHost.ensureSession()` 启动 Agent runtime，并创建或恢复 ACP session。
- 同一个 Agent 可以同时保持多个 ACP session 连接；平台只拒绝同一个本地 Session 内的并发 turn。
- 空闲回收分两层：先 close/disconnect 空闲 ACP session，再停止空闲 ACP runtime 进程。已持久化 messages/events 和 `sessions.acp_session_id` 都会保留。
