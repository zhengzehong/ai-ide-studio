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
│  │  ├─ prompt()     → 发送消息给 Agent        │     │
│  │  ├─ setModel()   → 切换模型                │     │
│  │  └─ setMode()    → 切换模式                │     │
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
│  │  └─ rules                                  │     │
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

## 目录功能映射

| 目录 | 职责 | 核心文件 |
|------|------|----------|
| `src/acp/` | ACP 协议集成 | `host.ts`（协议编排）、`adapters.ts`（运行时适配） |
| `src/core/` | 业务逻辑 | `sessions.ts`、`tasks.ts`、`events.ts` |
| `src/gateway/` | 对外接口 | `ws-handler.ts`（WS RPC）、`server.ts`（HTTP） |
| `src/store/` | 数据持久化 | `db.ts`（初始化/迁移）、各实体 CRUD |
| `src/cli/` | 命令行工具 | `index.ts`（agents/sessions/tasks/rules） |
| `src/types/` | 类型定义 | `ws-protocol.ts`（WS 消息接口） |
| `ui/src/pages/` | 页面组件 | Workspace/Dashboard/TaskBoard/Schedule |
| `ui/src/stores/` | 前端状态 | Zustand store + session-events 事件还原 |
| `ui/src/services/` | 通信层 | `ws-client.ts`（WS 客户端） |

## 支持的 Agent 运行时

| 运行时 | 包 | 状态 |
|--------|-----|------|
| `mock` | 内置 | ✅ 可用（开发/测试） |
| `claude` | `@agentclientprotocol/claude-agent-acp` | ✅ 可用 |
| `codex` | `@agentclientprotocol/codex-acp` | ✅ 可用 |
| `gemini` | — | ❌ 未接入 |

## 未实现的设计目标

以下在设计文档中有描述，但当前代码未实现：

- Memory/RAG 记忆系统
- 多 Agent 协作引擎
- 事件触发自动化（Schedule 仅有规则管理 UI）
- 插件系统
- MCP Server 模式
