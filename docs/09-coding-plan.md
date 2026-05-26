# 编码实施方案

> 目标：走通「用户发消息 → Agent 回复」和「创建任务 → 分派 Agent」的完整流程。

## 当前状态

```
12 个源文件，全部是前端：
  src/App.tsx, src/main.tsx, src/index.css
  src/types/index.ts, src/data/mockData.ts
  src/components/layout/AppLayout.tsx + .css
  src/components/chat/ChatView.tsx
  src/components/session/SessionTimeline.tsx
  src/pages/Dashboard.tsx, Workspace.tsx, TaskBoard.tsx, Schedule.tsx

依赖：react 19, react-router-dom 7, lucide-react, vite 8, typescript 6
后端：无
状态管理：无（各页面 useState）
```

## 目标状态

```
能跑的完整链路：

链路 1 — 对话：
  浏览器输入消息 → WS → Gateway → ACP → Claude Agent → 流式回复 → WS → 浏览器渲染

链路 2 — 任务：
  浏览器创建任务 → WS → Gateway → SQLite 存储 → 分派 Agent → Agent 自动开 Session

链路 3 — CLI：
  ai-ide tasks create "xxx" → 操作 SQLite → 输出 JSON
```

---

## Step 0：项目结构改造

**做什么**：把单体前端项目改成 workspace 结构，前端移到 `ui/`，根目录变成后端。

### 0.1 目标结构

```
ai-ide-studio/
├── package.json              ← workspace 根（新建）
├── tsconfig.json             ← 根 TS 配置（改造）
├── tsconfig.server.json      ← 后端 TS 配置（新建）
├── .env                      ← 环境变量（新建）
├── config.json               ← 运行配置（新建）
│
├── src/                      ← 后端代码（新建）
│   ├── types/                ← 共享类型（从 ui 引用）
│   └── ...
│
├── ui/                       ← 前端（从原 src/ 迁移）
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── index.html
│   └── src/                  ← 原来的 src/ 内容搬到这里
│
└── docs/
```

### 0.2 具体步骤

```
1. 创建 ui/ 目录
2. 移动前端文件到 ui/：
   - src/ → ui/src/
   - index.html → ui/index.html
   - vite.config.ts → ui/vite.config.ts
   - tsconfig.app.json → ui/tsconfig.app.json
   - eslint.config.js → ui/eslint.config.js
   - public/ → ui/public/
3. 创建 ui/package.json（前端依赖）
4. 改造根 package.json（workspace + 后端依赖）
5. 创建 tsconfig.server.json（后端 TS 配置）
6. 修改根 tsconfig.json（引用 server + ui）
7. 验证：cd ui && npm run dev 能跑
```

### 0.3 根 package.json

```jsonc
{
  "name": "ai-ide-studio",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "workspaces": ["ui"],
  "scripts": {
    "dev": "tsx watch src/entry.ts",
    "dev:ui": "npm run dev -w ui",
    "dev:all": "concurrently \"npm run dev\" \"npm run dev:ui\"",
    "build": "tsc -p tsconfig.server.json && npm run build -w ui",
    "start": "node dist/entry.js"
  },
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.19.0",
    "@hono/node-server": "^1.14.0",
    "better-sqlite3": "^11.8.0",
    "commander": "^13.1.0",
    "dotenv": "^16.5.0",
    "hono": "^4.7.0",
    "mitt": "^3.0.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/ws": "^8.18.0",
    "concurrently": "^9.1.0",
    "tsx": "^4.19.0",
    "typescript": "~6.0.2"
  },
  "bin": {
    "ai-ide": "./dist/cli/index.js"
  }
}
```

### 0.4 ui/package.json

```jsonc
{
  "name": "ai-ide-studio-ui",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^1.16.0",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-router-dom": "^7.15.1",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "typescript": "~6.0.2",
    "vite": "^8.0.12"
  }
}
```

---

## Step 1：后端骨架

**做什么**：Gateway 能启动，HTTP 能返回 health，WS 能连接。

### 1.1 文件清单

```
新建：
  src/entry.ts              ← 程序入口
  src/core/config.ts        ← 配置加载
  src/core/events.ts        ← mitt 事件总线
  src/gateway/server.ts     ← HTTP + WS 服务器
  src/gateway/ws-handler.ts ← WS 消息处理
  src/types/ws-protocol.ts  ← WS 消息类型
  .env.example              ← 环境变量模板
  config.json               ← 运行配置
```

### 1.2 核心代码概要

**src/entry.ts** — 整个程序的入口：
```typescript
import { loadConfig } from './core/config.js'
import { startGateway } from './gateway/server.js'

const config = loadConfig()
await startGateway(config)
console.log(`Gateway running on http://localhost:${config.port}`)
```

**src/gateway/server.ts** — 启动 HTTP + WS：
```typescript
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { handleWsConnection } from './ws-handler.js'

export async function startGateway(config) {
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok' }))

  const server = serve({ fetch: app.fetch, port: config.port })

  const wss = new WebSocketServer({ server })
  wss.on('connection', handleWsConnection)

  return { app, server, wss }
}
```

**src/gateway/ws-handler.ts** — WS 消息处理骨架：
```typescript
export function handleWsConnection(ws, req) {
  const subscriptions = new Set<string>()

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    switch (msg.type) {
      case 'subscribe': ...
      case 'prompt': ...
      case 'decision': ...
    }
  })
}
```

**src/types/ws-protocol.ts** — WS 消息类型定义：
```typescript
// 客户端 → 服务端
export type ClientMessage =
  | { type: 'subscribe'; sessionIds: string[] }
  | { type: 'unsubscribe'; sessionIds: string[] }
  | { type: 'prompt'; sessionId: string; content: string }
  | { type: 'decision'; sessionId: string; messageId: string; choice: string }
  | { type: 'agents.list' }
  | { type: 'sessions.list'; agentId?: string }
  | { type: 'sessions.create'; agentId: string; taskId?: string }
  | { type: 'tasks.list' }
  | { type: 'tasks.create'; title: string; description?: string; assignAgentId?: string }

// 服务端 → 客户端
export type ServerMessage =
  | { type: 'session:update'; sessionId: string; agentId: string; data: SessionUpdateData }
  | { type: 'agent:status'; agentId: string; status: AgentStatus }
  | { type: 'task:update'; taskId: string; data: Partial<Task> }
  | { type: 'notification'; data: Notification }
  | { type: 'result'; requestId?: string; data: unknown }
  | { type: 'error'; message: string }
```

### 1.3 验证标准

```bash
npm run dev
# Gateway running on http://localhost:18800

curl http://localhost:18800/health
# {"status":"ok"}

# WS 连接测试（用 wscat 或浏览器控制台）
wscat -c ws://localhost:18800
> {"type":"subscribe","sessionIds":["test"]}
< {"type":"result","data":"subscribed"}
```

---

## Step 2：SQLite 存储层

**做什么**：建表，能 CRUD Agent/Session/Task/Message。

### 2.1 文件清单

```
新建：
  src/store/db.ts           ← SQLite 初始化 + 建表
  src/store/agents.ts       ← Agent CRUD
  src/store/sessions.ts     ← Session + Message CRUD
  src/store/tasks.ts        ← Task CRUD
```

### 2.2 数据库 Schema

```sql
-- agents 表
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,         -- dev/test/ops/security/architect/pm
  name TEXT NOT NULL,
  runtime TEXT NOT NULL,      -- claude/codex/gemini/custom
  status TEXT DEFAULT 'standby',  -- running/idle/standby/sleeping
  permission_level INTEGER DEFAULT 3,
  config_json TEXT,           -- Agent 专属配置 JSON
  created_at TEXT DEFAULT (datetime('now'))
);

-- sessions 表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  task_id TEXT REFERENCES tasks(id),
  acp_session_id TEXT,        -- ACP 协议层的 Session ID
  status TEXT DEFAULT 'active',
  stage TEXT DEFAULT '',
  started_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT
);

-- messages 表（Session 的消息历史）
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,          -- human/agent/system
  content TEXT NOT NULL,
  thinking TEXT,               -- Agent 思考过程
  tool_calls_json TEXT,        -- ToolCall[] JSON
  decision_json TEXT,          -- Decision JSON
  timestamp TEXT DEFAULT (datetime('now'))
);

-- tasks 表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT DEFAULT 'human',
  status TEXT DEFAULT 'backlog',
  stage TEXT DEFAULT '',
  assigned_agent_id TEXT REFERENCES agents(id),
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- subtasks 表
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT NOT NULL,
  status TEXT DEFAULT 'waiting',
  assigned_agent_id TEXT
);
```

### 2.3 验证标准

```typescript
// 能跑这些操作不报错
const db = initDatabase('./data/test.db')
const agentId = agentStore.create({ type: 'dev', name: 'Alpha', runtime: 'claude' })
const taskId = taskStore.create({ title: '实现支付接口' })
const sessionId = sessionStore.create({ agentId, taskId })
messageStore.append(sessionId, { role: 'human', content: 'Hello' })
const messages = messageStore.list(sessionId, { limit: 50 })
```

---

## Step 3：ACP Host — Agent 进程管理

**做什么**：能 spawn 一个 ACP Agent 子进程，完成 initialize 握手。

### 3.1 文件清单

```
新建：
  src/acp/host.ts           ← ACP Host 主类
  src/acp/process.ts        ← 子进程管理
  src/acp/adapters.ts       ← Agent 启动配置（Claude/Codex/Gemini）
```

### 3.2 核心代码概要

**src/acp/host.ts** — 管理所有 Agent 连接：
```typescript
import * as acp from '@agentclientprotocol/sdk'

export class ACPHost {
  private agents = new Map<string, AgentConnection>()

  async startAgent(agentId: string, adapter: AdapterConfig): AgentConnection
  async stopAgent(agentId: string): void
  async newSession(agentId: string, cwd: string): AcpSessionInfo
  async prompt(agentId: string, sessionId: string, content: string): void
  async closeSession(agentId: string, sessionId: string): void

  getAgent(agentId: string): AgentConnection | undefined
  listRunningAgents(): string[]
}
```

**src/acp/process.ts** — 单个 Agent 子进程：
```typescript
export class AgentProcess {
  private proc: ChildProcess
  private connection: acp.ClientSideConnection

  constructor(command: string, args: string[], env: Record<string,string>)

  async start(): Promise<acp.InitializeResult>  // spawn + ACP initialize
  async stop(): Promise<void>                    // kill process
  get isRunning(): boolean
}
```

**src/acp/adapters.ts** — 各 Agent 的启动配置：
```typescript
export const ADAPTERS = {
  claude: {
    command: 'npx',
    args: ['@agentclientprotocol/claude-agent-acp'],
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  codex: {
    command: 'npx',
    args: ['@zed-industries/codex-acp'],
    envKeys: ['OPENAI_API_KEY'],
  },
  gemini: {
    command: 'gemini',
    args: ['--experimental-acp'],
    envKeys: ['GOOGLE_API_KEY'],
  },
} as const
```

### 3.3 验证标准

```bash
# 配好 ANTHROPIC_API_KEY 后
npm run dev
# 在另一个终端：
curl -X POST http://localhost:18800/api/agents/test-claude/start
# → Agent 进程启动，ACP initialize 成功
# → 日志显示 capabilities
```

---

## Step 4：Session + 对话流

**做什么**：完整的「发消息 → 收回复」链路，通过 WS。

### 4.1 文件修改

```
修改：
  src/gateway/ws-handler.ts  ← 补充 prompt/subscribe 处理
  src/acp/host.ts            ← 补充 ACP 事件回调 → emit
  src/core/events.ts         ← 定义事件类型

新建：
  src/core/sessions.ts       ← Session 业务逻辑（连接 ACPHost + Store）
```

### 4.2 对话链路详解

```
前端 WS 发送：
  { type: 'prompt', sessionId: 's-001', content: '帮我重构 auth 模块' }

ws-handler.ts 收到：
  1. 从 sessionStore 找到 session → 拿到 agentId + acpSessionId
  2. 调 acpHost.prompt(agentId, acpSessionId, content)
  3. 同时把 human 消息写入 messageStore

acp/host.ts 的 ClientSideConnection 回调触发：
  sessionUpdate(sessionId, update) {
    // ACP Agent 流式输出
    events.emit('session:update', { agentId, sessionId, update })
  }

ws-handler.ts 监听 'session:update' 事件：
  1. 检查哪些 WS 客户端订阅了这个 sessionId
  2. 构造 ServerMessage，发送给订阅者
  3. 异步写入 messageStore（不阻塞转发）
```

### 4.3 ACP Update → ChatMessage 的转换

```typescript
function acpUpdateToChatMessage(update: acp.SessionUpdate): Partial<ChatMessage> {
  // ACP 的 content block 类型：
  //   text       → content 字段
  //   thinking   → thinking 字段
  //   tool_call  → toolCalls 字段
  //   tool_result → toolCalls[].result 更新

  // ACP 的 permission_request → decision 字段
}
```

### 4.4 验证标准

```
1. 浏览器打开 ws://localhost:18800
2. 发送 subscribe { sessionIds: ['s-001'] }
3. 发送 prompt { sessionId: 's-001', content: 'Hello Claude' }
4. 收到多条 session:update 消息（流式文本）
5. 最后收到 prompt:result
6. SQLite 里 messages 表有记录
```

---

## Step 5：Task 管理

**做什么**：创建任务 → 分派 Agent → 自动创建 Session。

### 5.1 文件

```
新建：
  src/core/tasks.ts          ← Task 业务逻辑 + 状态机
```

### 5.2 Task 状态机

```
backlog → planning → executing → reviewing → completed
                  ↘  blocked  ↗           ↘ cancelled
```

### 5.3 任务分派流

```
tasks.create({ title, assignAgentId }) :
  1. taskStore.create() → 存入 SQLite
  2. 如果有 assignAgentId:
     a. 检查 Agent 是否 running，没有就 acpHost.startAgent()
     b. acpHost.newSession(agentId, cwd) → 拿到 ACP sessionId
     c. sessionStore.create({ agentId, taskId, acpSessionId })
     d. acpHost.prompt(agentId, acpSessionId, 自动构造的启动 prompt)
        prompt 内容 = "你被分派了任务：{title}。{description}。请开始工作。"
     e. taskStore.updateStatus(taskId, 'executing')
  3. events.emit('task:update', { taskId, ... })
  4. → WS 推送给前端
```

### 5.4 验证标准

```
WS 发送：
  { type: 'tasks.create', title: '实现支付回调', assignAgentId: 'dev-alpha' }

预期结果：
  1. SQLite tasks 表有新记录
  2. dev-alpha Agent 进程启动（如果没启动）
  3. 自动创建了一个 Session
  4. Agent 收到了任务 prompt 并开始工作
  5. WS 收到 task:update + session:update 事件
```

---

## Step 6：前端迁移 + 接入

**做什么**：前端从 mock 数据切到 WS 实时数据。

### 6.1 新增文件

```
新建（ui/src/ 下）：
  stores/connection.store.ts   ← WS 连接管理
  stores/agent.store.ts        ← Agent 列表（从 WS 获取）
  stores/session.store.ts      ← Session + 消息（从 WS 获取）
  stores/task.store.ts         ← Task 列表（从 WS 获取）
  services/ws-client.ts        ← WS 连接 + 消息分发

修改：
  stores → 所有页面从 import mockData 改为 useXxxStore()
  Workspace.tsx               ← 核心改造，接入真实对话
  Dashboard.tsx               ← 接入真实数据
  TaskBoard.tsx               ← 接入真实数据
```

### 6.2 WS Client 核心

```typescript
// services/ws-client.ts
class WSClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Function>()

  connect(url: string) { ... }
  disconnect() { ... }

  // 发送请求并等待响应
  async request(msg: ClientMessage): Promise<unknown> { ... }

  // 订阅 Session 更新
  subscribe(sessionIds: string[]) { ... }
  unsubscribe(sessionIds: string[]) { ... }

  // 发送 prompt
  sendPrompt(sessionId: string, content: string) { ... }

  // 注册事件处理器
  onSessionUpdate(handler: (data) => void) { ... }
  onAgentStatus(handler: (data) => void) { ... }
  onTaskUpdate(handler: (data) => void) { ... }
}

export const wsClient = new WSClient()
```

### 6.3 Zustand Store 示例

```typescript
// stores/session.store.ts
interface SessionStore {
  sessions: Session[]
  currentSessionId: string | null
  messages: ChatMessage[]        // 当前 Session 的消息

  // 操作
  selectSession(id: string): void
  fetchSessions(): Promise<void>
  fetchMessages(sessionId: string): Promise<void>
  appendMessage(msg: ChatMessage): void    // WS 推送时调用
  sendPrompt(content: string): void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],

  selectSession(id) {
    const prev = get().currentSessionId
    if (prev) wsClient.unsubscribe([prev])
    wsClient.subscribe([id])
    set({ currentSessionId: id, messages: [] })
    get().fetchMessages(id)
  },

  async fetchMessages(sessionId) {
    const msgs = await wsClient.request({ type: 'sessions.messages', sessionId })
    set({ messages: msgs })
  },

  appendMessage(msg) {
    set(state => ({ messages: [...state.messages, msg] }))
  },

  sendPrompt(content) {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    wsClient.sendPrompt(sessionId, content)
    // 立即乐观添加 human 消息
    get().appendMessage({
      id: crypto.randomUUID(),
      role: 'human',
      content,
      timestamp: new Date().toISOString(),
    })
  },
}))
```

### 6.4 Workspace 改造要点

```
现状：Workspace.tsx 从 mockData import 数据
目标：从 Zustand store 取数据，消息通过 WS 实时来

关键改动：
  1. 左栏 Agent 树 ← useAgentStore().agents
  2. 中栏对话 ← useSessionStore().messages
  3. 右栏任务 ← useTaskStore().tasks
  4. 输入框 ← useSessionStore().sendPrompt(content)
  5. 选择 Session ← useSessionStore().selectSession(id)
  6. ChatView 组件集成到中栏（替换内联实现）
```

### 6.5 验证标准

```
完整流程测试：

1. npm run dev:all（同时启动后端 + 前端）
2. 浏览器打开 http://localhost:5173
3. 左栏看到 Agent 列表（从 SQLite 读取的）
4. 点击一个 Agent → 看到它的 Session 列表
5. 点击一个 Session → 中栏加载消息历史
6. 输入框输入消息 → 发送
7. 看到 Agent 流式回复（文字逐字出现）
8. 思考块可折叠，工具调用可展开
9. 刷新页面 → 消息历史仍在（从 SQLite 加载）
```

---

## Step 7：CLI 命令

**做什么**：让 AI Agent 能通过命令行操作我们的系统。

### 7.1 文件

```
新建：
  src/cli/index.ts           ← Commander 入口
  src/cli/agents.ts          ← agents 子命令
  src/cli/sessions.ts        ← sessions 子命令
  src/cli/tasks.ts           ← tasks 子命令
```

### 7.2 命令设计

```bash
ai-ide                               # 默认启动 Gateway
ai-ide --help                        # 帮助

ai-ide agents list [--json]          # 列出 Agent
ai-ide agents start <id>             # 启动 Agent
ai-ide agents stop <id>              # 停止 Agent

ai-ide sessions list [--agent <id>] [--json]
ai-ide sessions create --agent <id> [--task <id>]
ai-ide sessions close <id>

ai-ide tasks list [--status <s>] [--json]
ai-ide tasks create <title> [--assign <agentId>] [--description <d>]
ai-ide tasks update <id> --status <s>

ai-ide prompt <sessionId> <message>  # 发消息给 Agent

ai-ide status [--json]               # 系统状态
```

### 7.3 CLI ↔ Gateway 通信

```
CLI 需要跟 Gateway 进程通信，两种方式：

方式 A（Gateway 在跑）：
  CLI → WebSocket 连接 localhost:18800 → 发请求 → 收结果 → 断开
  优点：能触发 Agent 操作（prompt 等）
  
方式 B（Gateway 没跑）：
  CLI → 直接读写 SQLite
  优点：纯数据查询不需要 Gateway
  限制：不能操作 Agent

实现：CLI 先尝试 WS 连接，连不上就 fallback 到直接 SQLite
```

### 7.4 验证标准

```bash
# Gateway 已启动的情况下
ai-ide status --json
# {"agents":2,"sessions":3,"tasks":5,"uptime":"2h30m"}

ai-ide tasks create "实现退款 API" --assign dev-alpha --json
# {"id":"task-xxx","title":"实现退款 API","status":"executing","sessionId":"sess-xxx"}

ai-ide agents list --json
# [{"id":"dev-alpha","status":"running","sessions":2}, ...]
```

---

## 执行顺序和依赖关系

```
Step 0: 项目结构改造
  ↓ （独立，无依赖）
Step 1: 后端骨架 (Gateway HTTP+WS)
  ↓ 依赖 Step 0
Step 2: SQLite 存储层
  ↓ 依赖 Step 0（和 Step 1 并行也行）
Step 3: ACP Host
  ↓ 依赖 Step 1 + Step 2
Step 4: Session 对话流
  ↓ 依赖 Step 3
Step 5: Task 管理
  ↓ 依赖 Step 4
Step 6: 前端迁移 + 接入
  ↓ 依赖 Step 4（可以和 Step 5 并行）
Step 7: CLI
  ↓ 依赖 Step 2 + Step 4
```

**最短路径**（一个人做）：

```
Step 0 → Step 1 → Step 2 → Step 3 → Step 4 → Step 6 → Step 5 → Step 7
  半天     半天     半天     1天      1天      1.5天    半天     半天
                                                     ≈ 6 天
```

**并行路径**（两个 Agent 协作）：

```
Agent A: Step 0 → Step 1 → Step 3 → Step 4 → Step 6
Agent B:           Step 2 →           Step 5 → Step 7
                                            ≈ 4 天
```

---

## 每步完成后的可验证里程碑

| Step | 里程碑 | 怎么验证 |
|------|--------|---------|
| 0 | 结构改造完成 | `cd ui && npm run dev` 前端能跑 |
| 1 | Gateway 能启动 | `curl /health` 返回 ok，WS 能连 |
| 2 | 存储层就绪 | 能 CRUD Agent/Session/Task/Message |
| 3 | Agent 能启动 | Claude Agent 子进程运行，ACP 握手成功 |
| 4 | 对话能跑 | WS 发 prompt → 收到 Agent 流式回复 |
| 5 | 任务能管理 | 创建任务 → 自动分派 → Agent 开始工作 |
| 6 | 前端显示真实数据 | 浏览器里看到真实 Agent 回复，不是 mock |
| 7 | CLI 可用 | `ai-ide tasks create` 能工作 |

---

## 需要的 API Key（测试用）

```
至少需要一个：
  ANTHROPIC_API_KEY  — 测试 Claude Agent
  
可选：
  OPENAI_API_KEY     — 测试 Codex Agent
  GOOGLE_API_KEY     — 测试 Gemini Agent
```

没有 API Key 也能开发 Step 0-2 + Step 6 的大部分工作。
Step 3-4 需要真实 API Key 来测试 ACP Agent 连接。
