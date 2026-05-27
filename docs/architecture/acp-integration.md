# 全栈架构规划 — Gateway 中心 + 微内核可扩展

## Current implementation boundary (2026-05-27)

- Real Agent runtimes currently exposed by this repository are `mock`, `claude`, and `codex`.
- Gemini is not connected yet; any Gemini references in older architecture examples are future-target notes, not current capability.
- Memory/RAG, true Multi-Agent collaboration, and event-triggered automation are future capabilities.
- SQLite persistence is active via `better-sqlite3`; legacy JSON `data/ai-ide.db` is migrated into `data/ai-ide.sqlite` when present.


> 本文档基于对 OpenClaw、OpenACP、ACP 协议生态、微内核 Agent 架构的深度调研而成。

## 一、核心设计理念

### 1.1 不做传统前后端分离

OpenClaw 的教训：**不是** React SPA + Express API 两个仓库。而是——

**Gateway 中心架构**：
- 一个 Node.js 进程 = 整个系统
- Web UI 是 Gateway 托管的静态资源
- CLI / Web UI / 外部 AI 都是 Gateway 的客户端
- 所有能力通过 **插件注册**，核心只做调度

```
我们不是在做一个"有后端的网站"
我们是在做一个"有 Web 界面的 Agent 控制平面"
```

### 1.2 微内核 + 插件

借鉴 OpenClaw（117 插件包）和 OpenACP（微内核文档）的设计：

```
┌─────────────────────────────────────────────┐
│              Microkernel Core               │
│                                             │
│   EventBus · ServiceRegistry · Config       │
│   PluginLoader · SessionManager             │
│                                             │
│   "核心只做调度，不做业务"                    │
└─────────────────┬───────────────────────────┘
                  │ register()
    ┌─────────────┼─────────────────┐
    │             │                 │
┌───▼───┐  ┌─────▼─────┐  ┌───────▼──────┐
│ ACP   │  │  Tools &  │  │  Web UI &   │
│ Agent │  │  MCP &    │  │  HTTP &     │
│ 适配器 │  │  Skills   │  │  WS 网关    │
└───────┘  └───────────┘  └──────────────┘
  插件        插件             插件
```

### 1.3 API 原生暴露，AI 可消费

所有 API 不是"给前端用的"，而是——
- **AI 可直接调用**（创建会话、分派任务、查询状态）
- **CLI 可调用**（命令行管理）
- **Web UI 调用**（浏览器界面）
- **外部系统可调用**（Webhook、自动化）

```
同一套 API，四种消费方式：
  1. Web UI（WebSocket RPC）
  2. CLI（直连 Gateway WS）
  3. AI Agent（HTTP REST / WS RPC）
  4. 外部集成（HTTP + Webhook）
```

---

## 二、系统架构

### 2.1 整体架构图

```
                    ┌─────────────────────────────────────┐
                    │          消费者（客户端）              │
                    │                                     │
                    │  Web UI   CLI    AI Agent   Webhook │
                    │  (WS)    (WS)   (HTTP)    (HTTP)   │
                    └─────────┬───────────────────────────┘
                              │
                    ┌─────────▼───────────────────────────┐
                    │         Gateway (单进程)              │
                    │                                     │
                    │  ┌──────────┐  ┌──────────────────┐ │
                    │  │ HTTP 层  │  │  WebSocket RPC   │ │
                    │  │ REST API │  │  实时双向通信     │ │
                    │  └────┬─────┘  └───────┬──────────┘ │
                    │       │                │            │
                    │  ┌────▼────────────────▼──────────┐ │
                    │  │       Microkernel Core         │ │
                    │  │                                │ │
                    │  │  EventBus ─── ServiceRegistry  │ │
                    │  │  ConfigManager ─── PluginMgr   │ │
                    │  │  SessionManager ─── TaskEngine  │ │
                    │  │                                │ │
                    │  └──────┬─────────────────────────┘ │
                    │         │                           │
                    │  ┌──────▼─────────────────────────┐ │
                    │  │       Plugin Registry          │ │
                    │  │                                │ │
                    │  │  ┌─────────┐ ┌──────────────┐  │ │
                    │  │  │ ACP 适配│ │ Tool/MCP     │  │ │
                    │  │  │ 器插件  │ │ 桥接插件     │  │ │
                    │  │  ├─────────┤ ├──────────────┤  │ │
                    │  │  │ Skill   │ │ Memory/RAG   │  │ │
                    │  │  │ 加载插件│ │ 插件         │  │ │
                    │  │  ├─────────┤ ├──────────────┤  │ │
                    │  │  │ Web UI  │ │ Cron/自动化  │  │ │
                    │  │  │ 托管插件│ │ 插件         │  │ │
                    │  │  └─────────┘ └──────────────┘  │ │
                    │  └────────────────────────────────┘ │
                    │                                     │
                    └──────────┬──────────────────────────┘
                               │ stdio (JSON-RPC)
                    ┌──────────▼──────────────────────────┐
                    │        ACP Agent 子进程              │
                    │                                     │
                    │  Claude Code  Codex  Mock  Future │
                    │  Cursor  Goose  Qwen  Pi  ...      │
                    │                                     │
                    │  （ACP Registry 中 30+ 可用 Agent）   │
                    └─────────────────────────────────────┘
```

### 2.2 核心不做什么

微内核原则——核心只负责：

| 核心管 | 核心不管 |
|--------|---------|
| 事件分发 | 具体 Agent 逻辑 |
| 插件生命周期 | UI 渲染 |
| 配置加载 | 网络协议细节 |
| 服务注册/发现 | 工具实现 |
| Session 基础管理 | 记忆检索算法 |

**所有具体能力都是插件。**

---

## 三、微内核设计

### 3.1 核心组件

```typescript
// ========== EventBus ==========
// 所有组件间通信的唯一通道
interface EventBus {
  emit(event: string, data: unknown): void
  on(event: string, handler: EventHandler): Unsubscribe
  once(event: string, handler: EventHandler): Unsubscribe
}

// 关键事件：
// session:created / session:updated / session:closed
// agent:started / agent:stopped / agent:status
// task:created / task:updated / task:completed
// message:incoming / message:outgoing
// decision:requested / decision:resolved
// tool:registered / tool:called / tool:result
// plugin:loaded / plugin:error

// ========== ServiceRegistry ==========
// 插件注册服务，其他插件通过 ID 获取
interface ServiceRegistry {
  register<T>(id: string, service: T): void
  get<T>(id: string): T | undefined
  require<T>(id: string): T  // 不存在则抛错
  has(id: string): boolean
}

// ========== ConfigManager ==========
// 配置加载 + 热重载 + 校验
interface ConfigManager {
  get<T>(path: string): T
  set(path: string, value: unknown): void
  watch(path: string, handler: ConfigChangeHandler): Unsubscribe
  getSchema(): JSONSchema          // 可被 AI 读取的配置结构
}

// ========== PluginManager ==========
// 插件发现 + 加载 + 生命周期
interface PluginManager {
  discover(): PluginManifest[]     // 扫描插件目录
  load(id: string): Promise<void>
  unload(id: string): Promise<void>
  list(): PluginInfo[]
}

// ========== SessionManager ==========
// Session 基础 CRUD + 生命周期
interface SessionManager {
  create(opts: CreateSessionOpts): Promise<Session>
  get(id: string): Session | undefined
  list(filter?: SessionFilter): Session[]
  close(id: string): Promise<void>
  resume(id: string): Promise<void>
}

// ========== TaskEngine ==========
// 任务状态机 + 分派
interface TaskEngine {
  create(task: CreateTaskOpts): Promise<Task>
  assign(taskId: string, agentId: string): Promise<void>
  updateStage(taskId: string, stage: string): void
  complete(taskId: string): Promise<void>
  list(filter?: TaskFilter): Task[]
}
```

### 3.2 插件接口

```typescript
interface Plugin {
  id: string
  name: string
  version: string
  dependencies?: string[]           // 依赖的其他插件 ID

  setup(ctx: PluginContext): Promise<void>    // 初始化
  teardown?(): Promise<void>                  // 清理
}

// 插件拿到的上下文——访问核心能力的唯一入口
interface PluginContext {
  eventBus: EventBus
  services: ServiceRegistry
  config: ConfigManager
  sessions: SessionManager
  tasks: TaskEngine
  logger: Logger

  // 注册扩展点
  registerTool(tool: ToolDefinition): void
  registerAgentAdapter(adapter: AgentAdapter): void
  registerHttpRoute(method: string, path: string, handler: HttpHandler): void
  registerWsMethod(method: string, handler: WsHandler): void
  registerCommand(cmd: CommandDefinition): void
  registerSkillLoader(loader: SkillLoader): void
  registerMiddleware(phase: string, middleware: Middleware): void
}
```

### 3.3 扩展点总览

| 扩展点 | 注册方法 | 用途 | 示例 |
|--------|---------|------|------|
| **Agent 适配器** | `registerAgentAdapter` | 接入不同 ACP Agent | Claude/Codex/Mock; Gemini future/自定义 |
| **Tool** | `registerTool` | Agent 可调用的工具 | 文件操作/Git/浏览器/自定义 |
| **HTTP 路由** | `registerHttpRoute` | 扩展 HTTP API | OpenAI 兼容层/Webhook |
| **WS 方法** | `registerWsMethod` | 扩展 WebSocket RPC | 自定义实时命令 |
| **CLI 命令** | `registerCommand` | 扩展 CLI | 自定义管理命令 |
| **Skill 加载器** | `registerSkillLoader` | 加载 Skill/Prompt 模板 | SKILL.md 解析/SkillHub |
| **中间件** | `registerMiddleware` | 消息处理管线 | 安全过滤/日志/审计 |
| **服务** | `services.register` | 注册任何自定义服务 | 记忆存储/向量DB |

---

## 四、插件体系

### 4.1 内置插件

开箱即用，可禁用但不可卸载：

```
plugins/
├── acp-host/              # ACP 主机：管理 Agent 子进程
│   ├── index.ts           # 插件入口
│   ├── host.ts            # ACP ClientSideConnection 管理
│   ├── process-manager.ts # 子进程生命周期
│   └── adapters/          # 内置适配器配置
│       ├── claude.ts
│       ├── codex.ts
│       ├── mock.ts
│       └── registry.ts    # 从 ACP Registry 自动发现
│
├── web-ui/                # Web 界面托管
│   ├── index.ts           # 注册 HTTP 静态服务 + WS 网关
│   └── ui-dist/           # 构建后的前端产物
│
├── tools-builtin/         # 内置工具集
│   ├── index.ts
│   ├── file-ops.ts        # read_file / write_file / list_dir
│   ├── git.ts             # git_status / git_diff / git_commit
│   ├── shell.ts           # exec_command
│   ├── browser.ts         # web_fetch / web_search
│   └── memory.ts          # recall_memory / save_memory
│
├── mcp-bridge/            # MCP 协议桥接
│   ├── index.ts           # 将外部 MCP Server 的工具注册到系统
│   └── mcp-client.ts      # MCP Client 连接管理
│
├── task-engine/           # 任务管理引擎
│   ├── index.ts
│   ├── state-machine.ts   # Task 状态流转
│   └── auto-dispatch.ts   # 自动分派逻辑
│
├── cron-scheduler/        # 定时任务 + 事件触发
│   ├── index.ts
│   ├── cron.ts            # Cron 调度器
│   └── event-triggers.ts  # 事件触发规则
│
├── memory-store/          # 记忆/持久化存储
│   ├── index.ts
│   ├── sqlite.ts          # SQLite 存储引擎
│   └── vector.ts          # 向量存储（为 RAG 预留）
│
├── notification/          # 通知系统
│   ├── index.ts
│   └── channels.ts        # WS 推送 / 邮件 / Webhook
│
└── skills-loader/         # Skill 加载系统
    ├── index.ts
    ├── parser.ts           # SKILL.md 解析
    └── registry.ts         # Skill 注册表
```

### 4.2 外部插件

通过 npm 安装或本地路径加载：

```bash
# 从 npm 安装
ai-ide-studio plugins install @ai-ide/voice-plugin
ai-ide-studio plugins install @ai-ide/jira-integration

# 从本地路径
ai-ide-studio plugins load ./my-custom-plugin
```

外部插件结构：

```
my-custom-plugin/
├── package.json           # name + "ai-ide-studio" 配置段
├── index.ts               # export default 实现 Plugin 接口
└── README.md
```

```jsonc
// package.json
{
  "name": "@ai-ide/my-plugin",
  "ai-ide-studio": {
    "extensions": ["./index.ts"],
    "capabilities": ["tool", "http-route"]
  }
}
```

### 4.3 加载流水线（四层）

```
1. Discovery    — 扫描 plugins/ + node_modules + config.plugins.paths
                   读取 manifest，不执行代码
                   
2. Validation   — 检查依赖满足、配置 schema 匹配、allow/deny 过滤
                   仍然不执行代码
                   
3. Loading      — 按依赖拓扑排序，依次调用 plugin.setup(ctx)
                   插件通过 ctx 注册扩展点
                   
4. Consumption  — Gateway 消费注册表（路由、工具、适配器...）
                   开始服务
```

---

## 五、ACP 集成深度设计

### 5.1 我们在 ACP 生态中的角色

```
                    ACP 生态
                    
  ┌─ Client 角色 ─────────────────────────┐
  │                                       │
  │  Zed / JetBrains / Neovim            │
  │  AI IDE Studio  ◄── 我们在这里        │
  │  acpx (headless CLI)                  │
  │  OpenClaw / OpenACP                   │
  │                                       │
  └───────────────────────────────────────┘
                    │
                ACP 协议
              (JSON-RPC/stdio)
                    │
  ┌─ Agent 角色 ─────────────────────────┐
  │                                       │
  │  Claude Code / Codex CLI / Mock │
  │  Cursor / Goose / Qwen Code / Pi     │
  │  Cline / Copilot / Junie / ...       │
  │                                       │
  │  ACP Registry 中 30+ Agent           │
  └───────────────────────────────────────┘
```

**双重角色设计：**
1. 作为 **ACP Client** — 启动并管理多个 Agent 子进程
2. 未来可作为 **ACP Server** — 暴露为 ACP Agent，让 Zed/JetBrains 连进来

### 5.2 ACP Host 插件核心代码

```typescript
// plugins/acp-host/host.ts
import * as acp from '@agentclientprotocol/sdk'

class ACPHost {
  private agents = new Map<string, ManagedAgent>()

  // 从 ACP Registry 发现可用 Agent
  async discoverAgents(): Promise<AgentManifest[]> {
    const registry = await fetch(
      'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
    )
    return registry.json()
  }

  // 启动 Agent（支持 npx / binary / custom command）
  async startAgent(id: string, config: AgentConfig) {
    const proc = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const connection = new acp.ClientSideConnection(
      this.createClientHandlers(id),
      proc.stdout,
      proc.stdin
    )

    const initResult = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: 'ai-ide-studio', version: '0.1.0' }
    })

    this.agents.set(id, { proc, connection, capabilities: initResult })
    this.eventBus.emit('agent:started', { id, capabilities: initResult })
  }

  // ACP session 操作
  async newSession(agentId: string, opts: NewSessionOpts) {
    const agent = this.agents.get(agentId)
    return agent.connection.newSession({
      cwd: opts.cwd,
      mcpServers: opts.mcpServers ?? []
    })
  }

  async prompt(agentId: string, sessionId: string, content: ContentBlock[]) {
    const agent = this.agents.get(agentId)
    return agent.connection.prompt({
      sessionId,
      prompt: content,
      messageId: crypto.randomUUID()
    })
  }

  async listSessions(agentId: string) {
    const agent = this.agents.get(agentId)
    return agent.connection.listSessions()
  }

  async resumeSession(agentId: string, sessionId: string) {
    const agent = this.agents.get(agentId)
    return agent.connection.resumeSession({ sessionId })
  }

  // ACP 事件 → EventBus 桥接
  private createClientHandlers(agentId: string): acp.ClientHandlers {
    return {
      sessionUpdate: (sessionId, update) => {
        this.eventBus.emit('session:updated', { agentId, sessionId, update })
      },
      requestPermission: async (options, sessionId, toolCall) => {
        // 发布决策请求，等待用户/AI 响应
        this.eventBus.emit('decision:requested', {
          agentId, sessionId, toolCall, options
        })
        return this.decisionQueue.waitFor(sessionId, toolCall.id)
      },
      sessionInfoUpdate: (sessionId, info) => {
        this.eventBus.emit('session:info', { agentId, sessionId, info })
      }
    }
  }
}
```

### 5.3 Agent 适配器配置

```typescript
// 内置适配器：从 ACP Registry 自动匹配
const builtinAdapters: Record<string, AgentAdapterConfig> = {
  claude: {
    registryId: 'claude-agent',
    command: 'npx',
    args: ['@agentclientprotocol/claude-agent-acp'],
    envKeys: ['ANTHROPIC_API_KEY']
  },
  codex: {
    registryId: 'codex-cli',
    command: 'npx',
    args: ['@zed-industries/codex-acp'],
    envKeys: ['OPENAI_API_KEY']
  },
  // Gemini is future work and is not exposed by current agents.create.
  gemini: {
    registryId: 'gemini-cli',
    command: 'gemini',
    args: ['--experimental-acp'],
    envKeys: ['GOOGLE_API_KEY']
  },
  cursor: {
    registryId: 'cursor',
    command: 'cursor-acp',
    args: [],
    envKeys: []
  }
}

// 用户自定义适配器
// config.json:
{
  "agents": {
    "my-agent": {
      "command": "./my-agent-binary",
      "args": ["--acp"],
      "env": { "MY_KEY": "xxx" }
    }
  }
}
```

---

## 六、Tool / MCP / Skill 可扩展设计

### 6.1 统一 Tool 注册

```typescript
interface ToolDefinition {
  name: string
  description: string                  // AI 可读的描述
  parameters: JSONSchema               // 参数 schema
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>
  
  // 元数据
  category?: string                    // 'file' | 'git' | 'browser' | 'custom'
  permissions?: PermissionLevel        // 需要的最低权限
  agentTypes?: AgentType[]             // 限制哪些 Agent 类型可用
}

// 注册示例
ctx.registerTool({
  name: 'read_file',
  description: '读取文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' }
    },
    required: ['path']
  },
  async execute({ path }, ctx) {
    const content = await fs.readFile(path, 'utf-8')
    return { success: true, content }
  }
})
```

### 6.2 MCP 桥接

MCP (Model Context Protocol) 让 Agent 可以调用外部工具服务。
我们的 MCP Bridge 插件将 MCP Server 的工具自动注册到系统：

```typescript
// plugins/mcp-bridge/index.ts
class MCPBridgePlugin implements Plugin {
  async setup(ctx: PluginContext) {
    const mcpServers = ctx.config.get<MCPServerConfig[]>('mcp.servers')

    for (const server of mcpServers) {
      const client = new MCPClient(server)
      await client.connect()

      // 将 MCP Server 的每个 tool 注册为系统 tool
      const tools = await client.listTools()
      for (const tool of tools) {
        ctx.registerTool({
          name: `mcp:${server.name}:${tool.name}`,
          description: tool.description,
          parameters: tool.inputSchema,
          category: 'mcp',
          async execute(args) {
            return client.callTool(tool.name, args)
          }
        })
      }
    }
  }
}
```

配置：

```jsonc
// config.json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
      },
      {
        "name": "github",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      }
    ]
  }
}
```

### 6.3 Skill 系统

Skill = 可复用的 Prompt 模板 + 上下文 + 工具组合：

```
skills/
├── code-review/
│   └── SKILL.md           # Skill 定义
├── refactor/
│   └── SKILL.md
├── test-generation/
│   └── SKILL.md
└── custom/                # 用户自定义
    └── my-skill/
        └── SKILL.md
```

```markdown
# SKILL.md 格式

---
name: code-review
description: 对代码变更进行全面审查
trigger: 用户要求代码审查时
tools_required: [read_file, git_diff]
agent_types: [dev, security]
---

## System Prompt 注入

你是一个严格的代码审查者，关注...

## 步骤

1. 获取变更文件列表
2. 逐文件审查
3. 输出审查报告
```

### 6.4 AI 感知层

让系统具备 AI 主动感知能力——不只是被动等用户命令：

```typescript
// plugins/ai-perception/ — AI 感知插件
class AIPerceptionPlugin implements Plugin {
  async setup(ctx: PluginContext) {
    // 1. 代码仓库感知
    ctx.registerTool({
      name: 'repo_scan',
      description: '扫描代码仓库结构和最近变更',
      async execute({ repoPath }) {
        // git log, file tree, recent changes
      }
    })

    // 2. 文件变更监听
    const watcher = chokidar.watch(workspacePath)
    watcher.on('change', (path) => {
      ctx.eventBus.emit('file:changed', { path })
      // Agent 可配置自动响应文件变更
    })

    // 3. Git 事件感知
    ctx.registerTool({
      name: 'git_pull',
      description: '拉取远程代码变更',
      async execute({ remote, branch }) { ... }
    })

    // 4. CI/CD 状态感知
    ctx.registerTool({
      name: 'ci_status',
      description: '查询 CI/CD 管线状态',
      async execute({ repo, branch }) { ... }
    })
  }
}
```

---

## 七、API 设计 — AI 原生

### 7.1 设计原则

```
API 的第一消费者是 AI，不是人。

这意味着：
  - 每个端点有清晰的自然语言描述
  - 参数 schema 是自描述的（JSON Schema）
  - 返回值结构化，易于 AI 解析
  - 提供 /api/schema 端点，AI 可自省可用操作
```

### 7.2 WebSocket RPC（主要接口）

```typescript
// 连接握手
→ { type: 'connect', clientInfo: { name, type, version } }
← { type: 'connected', capabilities: [...] }

// 请求-响应模式
→ { type: 'req', id: '1', method: 'sessions.list', params: {} }
← { type: 'res', id: '1', result: [...] }

// 服务端推送事件
← { type: 'event', event: 'session:updated', data: {...} }

// 方法列表（AI 可自省）
→ { type: 'req', id: '2', method: 'api.describe', params: {} }
← { type: 'res', id: '2', result: { methods: [...schema...] } }
```

### 7.3 完整 API 方法表

```
# ========== 系统 ==========
api.describe                    → 返回所有可用 API 及其 schema（AI 自省）
health                          → 健康检查
status                          → 系统状态（Agent 数/Session 数/内存等）
config.get / config.set         → 配置读写

# ========== Agent 管理 ==========
agents.list                     → 列出所有 Agent 实例
agents.available                → 列出可安装的 Agent（ACP Registry）
agents.start { id, config }     → 启动 Agent 进程
agents.stop { id }              → 停止 Agent 进程
agents.status { id }            → 获取 Agent 实时状态
agents.install { registryId }   → 从 ACP Registry 安装 Agent

# ========== Session 管理 ==========
sessions.list { agentId? }      → 列出 Session
sessions.create { agentId, taskId?, cwd? }  → 创建新 Session
sessions.close { sessionId }    → 关闭 Session
sessions.resume { sessionId }   → 恢复 Session
sessions.history { sessionId }  → 获取消息历史

# ========== 消息 ==========
prompt { sessionId, content }   → 发送消息给 Agent（触发流式回复）
decision.resolve { sessionId, messageId, choice }  → 回复决策点

# ========== 任务管理 ==========
tasks.list { status? }          → 列出任务
tasks.create { title, description, assignAgent? }  → 创建任务
tasks.update { id, ...patch }   → 更新任务
tasks.assign { taskId, agentId } → 分派任务给 Agent
tasks.complete { taskId }       → 完成任务

# ========== 工具 ==========
tools.list                      → 列出所有注册的工具（AI 可用）
tools.call { name, args }       → 直接调用工具
tools.schema { name }           → 获取工具参数 schema

# ========== Skill ==========
skills.list                     → 列出可用 Skill
skills.load { name }            → 加载 Skill 到当前上下文
skills.create { name, content } → 创建自定义 Skill

# ========== 自动化 ==========
behaviors.list                  → 列出自动化规则
behaviors.create { trigger, action, agentId }
behaviors.toggle { id, enabled }

# ========== 插件 ==========
plugins.list                    → 列出已安装插件
plugins.install { name }        → 安装插件
plugins.enable / plugins.disable

# ========== 通知 ==========
notifications.list              → 获取通知
notifications.read { id }       → 标记已读
```

### 7.4 HTTP REST（OpenAI 兼容 + 自定义）

```
# OpenAI 兼容（让现有 AI 工具直接对接）
POST /v1/chat/completions       → OpenAI Chat Completions 兼容
GET  /v1/models                 → 可用 Agent/模型列表

# 自定义 REST
GET  /api/agents                → 等同 WS agents.list
POST /api/agents/:id/start      → 等同 WS agents.start
POST /api/sessions              → 等同 WS sessions.create
POST /api/sessions/:id/prompt   → 等同 WS prompt（SSE 流式）
GET  /api/tasks                 → 等同 WS tasks.list
POST /api/tasks                 → 等同 WS tasks.create

# 元数据（AI 自省）
GET  /api/schema                → OpenAPI 规范
GET  /.well-known/ai-plugin.json → AI Plugin 描述
```

### 7.5 CLI

```bash
# 启动
ai-ide-studio                   # 启动 Gateway（前台）
ai-ide-studio --daemon          # 后台模式

# Agent 管理
ai-ide-studio agents list
ai-ide-studio agents start claude
# Gemini is not connected: do not create gemini runtime

# Session
ai-ide-studio sessions list
ai-ide-studio prompt --agent claude "重构 auth 模块"

# 任务
ai-ide-studio tasks create "实现支付接口"
ai-ide-studio tasks assign task-001 --agent dev-alpha

# 插件
ai-ide-studio plugins list
ai-ide-studio plugins install @ai-ide/my-plugin

# ACP 模式（让外部 IDE 连入）
ai-ide-studio acp              # 作为 ACP Server 暴露 stdio 接口
```

---

## 八、目录结构

```
ai-ide-studio/
│
├── src/                               # 全部源码（不分前后端目录）
│   │
│   ├── core/                          # ★ 微内核
│   │   ├── kernel.ts                  # 启动入口：组装核心组件
│   │   ├── event-bus.ts               # 事件总线
│   │   ├── service-registry.ts        # 服务注册
│   │   ├── config-manager.ts          # 配置管理
│   │   ├── plugin-manager.ts          # 插件加载器
│   │   ├── session-manager.ts         # Session 基础管理
│   │   ├── task-engine.ts             # 任务状态机
│   │   └── types.ts                   # 核心类型（Plugin/PluginContext/等）
│   │
│   ├── gateway/                       # ★ Gateway 层（HTTP + WS）
│   │   ├── server.ts                  # 启动 HTTP + WS 服务器
│   │   ├── ws-rpc.ts                  # WebSocket RPC 处理
│   │   ├── http-router.ts            # HTTP 路由（REST + 静态文件）
│   │   └── protocol.ts               # 消息编解码 + schema
│   │
│   ├── plugins/                       # ★ 内置插件
│   │   ├── acp-host/                  # ACP 主机
│   │   │   ├── index.ts
│   │   │   ├── host.ts
│   │   │   ├── process-manager.ts
│   │   │   └── adapters/
│   │   │       ├── claude.ts
│   │   │       ├── codex.ts
│   │   │       ├── mock.ts
│   │   │       └── registry-loader.ts
│   │   │
│   │   ├── web-ui/                    # Web 界面托管
│   │   │   └── index.ts
│   │   │
│   │   ├── tools-builtin/            # 内置工具
│   │   │   ├── index.ts
│   │   │   ├── file-ops.ts
│   │   │   ├── git.ts
│   │   │   ├── shell.ts
│   │   │   └── browser.ts
│   │   │
│   │   ├── mcp-bridge/               # MCP 桥接
│   │   │   ├── index.ts
│   │   │   └── mcp-client.ts
│   │   │
│   │   ├── skills-loader/            # Skill 加载
│   │   │   ├── index.ts
│   │   │   └── parser.ts
│   │   │
│   │   ├── memory-store/             # 存储 + 记忆
│   │   │   ├── index.ts
│   │   │   ├── sqlite.ts
│   │   │   └── vector.ts
│   │   │
│   │   ├── cron-scheduler/           # 定时/事件触发
│   │   │   └── index.ts
│   │   │
│   │   └── notification/             # 通知
│   │       └── index.ts
│   │
│   ├── cli/                           # CLI 入口
│   │   ├── index.ts                   # Commander 主命令
│   │   └── commands/                  # 子命令
│   │       ├── agents.ts
│   │       ├── sessions.ts
│   │       ├── tasks.ts
│   │       └── plugins.ts
│   │
│   ├── shared/                        # ★ 前后端共享代码
│   │   ├── types/                     # 共享 TypeScript 类型
│   │   │   ├── agent.ts
│   │   │   ├── session.ts
│   │   │   ├── task.ts
│   │   │   ├── chat.ts
│   │   │   ├── behavior.ts
│   │   │   ├── notification.ts
│   │   │   ├── ws-protocol.ts        # WS RPC 消息类型
│   │   │   └── index.ts
│   │   └── constants/
│   │       ├── agent-types.ts
│   │       └── permissions.ts
│   │
│   ├── entry.ts                       # 程序入口（CLI 或 Gateway）
│   └── index.ts                       # npm 包 programmatic API
│
├── ui/                                # ★ Web 前端（独立构建）
│   ├── package.json                   # 依赖：react, zustand, lucide-react
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css                  # CSS 变量（已有）
│       │
│       ├── stores/                    # Zustand
│       │   ├── agent.store.ts
│       │   ├── session.store.ts
│       │   ├── task.store.ts
│       │   ├── chat.store.ts
│       │   └── connection.store.ts    # WS 连接状态
│       │
│       ├── services/
│       │   ├── ws-rpc-client.ts       # WS RPC 客户端
│       │   └── event-handler.ts       # 服务端推送处理
│       │
│       ├── components/                # 从现有迁移
│       │   ├── layout/
│       │   ├── chat/
│       │   └── session/
│       │
│       └── pages/                     # 从现有迁移
│           ├── Dashboard.tsx
│           ├── Workspace.tsx
│           ├── TaskBoard.tsx
│           └── Schedule.tsx
│
├── skills/                            # Skill 模板目录
│   ├── code-review/SKILL.md
│   ├── refactor/SKILL.md
│   └── test-generation/SKILL.md
│
├── tools/                             # 辅助工具
│   └── acp_host_py/                   # Python ACP Host CLI
│       ├── pyproject.toml
│       └── src/
│
├── docs/                              # 设计文档
│   ├── 01-vision.md
│   ├── ...
│   └── 07-acp-architecture.md         # 本文档
│
├── package.json                       # 根（含 workspace 配置）
├── tsconfig.json
├── config.example.json                # 配置示例
├── AGENTS.md
└── README.md
```

### 8.1 为什么是 `src/` + `ui/` 而不是 `packages/server` + `packages/web`

| 传统分离（之前的方案） | Gateway 中心（现方案） |
|----------------------|---------------------|
| `packages/server` + `packages/web` | `src/` + `ui/` |
| 两个独立的 npm 包 | 一个核心 + 一个 UI |
| 前后端感觉是两个项目 | 一个系统，UI 只是客户端之一 |
| 共享类型需要单独包 | 共享类型在 `src/shared/` |
| 部署两个服务 | 部署一个进程 |

**参考 OpenClaw**：
- 核心在 `src/`（7000+ 文件）
- UI 在 `ui/`（独立 workspace，但 Gateway 托管）
- 不叫 "server" 和 "client"，因为 CLI 也是 client，移动端也是 client

---

## 九、配置系统

### 9.1 配置文件

```jsonc
// ~/.ai-ide-studio/config.json (JSON5)
{
  // Agent 配置
  "agents": {
    "defaults": {
      "cwd": "/workspace",
      "permissionLevel": 3
    },
    "list": [
      {
        "id": "dev-alpha",
        "type": "dev",
        "name": "Dev Alpha",
        "runtime": "claude",
        "model": "claude-sonnet-4",
        "tools": ["read_file", "write_file", "git", "shell"]
      },
      {
        "id": "dev-beta",
        "type": "dev",
        "name": "Dev Beta",
        "runtime": "codex",
        "tools": ["read_file", "write_file", "git"]
      }
    ]
  },

  // ACP 配置
  "acp": {
    "adapters": {
      "claude": {
        "command": "npx",
        "args": ["@agentclientprotocol/claude-agent-acp"],
        "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" }
      },
      "codex": {
        "command": "npx",
        "args": ["@zed-industries/codex-acp"],
        "env": { "OPENAI_API_KEY": "${OPENAI_API_KEY}" }
      }
    }
  },

  // MCP 服务器
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
      }
    ]
  },

  // 工具配置
  "tools": {
    "builtin": {
      "shell": { "enabled": true, "sandbox": false },
      "browser": { "enabled": true }
    }
  },

  // 插件
  "plugins": {
    "enabled": true,
    "paths": [],
    "entries": {}
  },

  // Gateway
  "gateway": {
    "host": "127.0.0.1",
    "port": 18800,
    "cors": true
  },

  // 存储
  "storage": {
    "path": "~/.ai-ide-studio/data",
    "engine": "sqlite"
  },

  // Skill
  "skills": {
    "paths": ["./skills", "~/.ai-ide-studio/skills"]
  }
}
```

### 9.2 环境变量

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GITHUB_TOKEN=...
AI_IDE_STUDIO_PORT=18800
AI_IDE_STUDIO_CONFIG=./config.json
AI_IDE_STUDIO_STATE_DIR=~/.ai-ide-studio
```

---

## 十、实现路线图（修订版）

### Phase 1：微内核 + Gateway 骨架（Week 1-2）

| 任务 | 详情 |
|------|------|
| 核心五件套 | EventBus / ServiceRegistry / ConfigManager / PluginManager / SessionManager |
| Gateway 启动 | Hono HTTP + ws WebSocket，能响应 health / status |
| 插件加载器 | 扫描 plugins/ 目录，按顺序调用 setup() |
| Web UI 托管 | 构建前端 → Gateway 静态服务 |
| CLI 入口 | Commander 基础命令 |

### Phase 2：ACP 集成 + 实时通信（Week 3-4）

| 任务 | 详情 |
|------|------|
| ACP Host 插件 | 启动 Agent 子进程，管理 ACP 连接 |
| Claude 适配器 | 第一个真实 Agent 跑通 |
| WS RPC | 前端 ↔ Gateway 完整消息链路 |
| Zustand 迁移 | 前端从 mock 切到 WS 实时数据 |
| 流式消息 | ACP session/update → WS → 前端实时渲染 |

### Phase 3：工具 + MCP + 持久化（Week 5-6）

| 任务 | 详情 |
|------|------|
| 内置工具插件 | file/git/shell/browser |
| MCP 桥接 | 外部 MCP Server 工具自动注册 |
| SQLite 存储 | Session/Task/Message 持久化 |
| Task 引擎 | 创建 → 分派 → 执行 → 完成全流程 |
| 更多 Agent | Codex / Gemini 适配器 | (future; not current)

### Phase 4：Skill + 记忆 + 自动化（Week 7-8）

| 任务 | 详情 |
|------|------|
| Skill 系统 | SKILL.md 解析 + Skill 注册表 |
| 记忆/RAG | recall_memory 实现 |
| Cron 调度 | 定时任务执行 |
| 事件触发 | Git push / PR / file change → Agent 动作 |
| AI 感知 | 文件监听、代码仓库感知 |

### Phase 5：生态 + 打磨（Week 9+）

| 任务 | 详情 |
|------|------|
| ACP Server 模式 | 让 Zed/JetBrains 连进来 |
| 插件 SDK 文档 | 第三方插件开发指南 |
| OpenAI 兼容 API | /v1/chat/completions |
| acp_host_py | Python CLI 辅助工具 |
| UI 完善 | 所有死按钮修复、ChatView 统一主题 |

---

## 十一、与 OpenClaw 的关键差异

| 维度 | OpenClaw | AI IDE Studio |
|------|----------|---------------|
| 定位 | 个人 AI 助手 + 多通道消息网关 | AI 编程协作 IDE + 任务管理 |
| Agent 默认 | Pi 嵌入式运行时 | ACP 外部 Agent（Claude/Codex/Mock; Gemini future） |
| UI | Lit Web Components | React 19 + Zustand |
| 核心关注 | 消息路由 + 通道集成 | 任务管理 + Agent 协作 + 代码感知 |
| 规模 | 936K 行，117 插件 | 轻量起步，关注可扩展性 |
| 配置 | JSON5 单文件 | JSON5 + 环境变量 |

**我们借鉴的**：Gateway 中心、插件体系、API 设计哲学、配置系统。
**我们不做的**：WhatsApp/Telegram 等消息通道、语音、移动端 App。
**我们独有的**：任务看板、多 Agent 协作可视化、Session 时间线、决策流可视化。

---

## 十二、技术选型最终版

| 组件 | 选型 | 理由 |
|------|------|------|
| 内核 + Gateway | Node.js 22 + TypeScript 6 | ACP TS SDK 最成熟，单语言全栈 |
| HTTP | Hono | 轻量、TS 原生、中间件优雅 |
| WebSocket | ws | Node.js 生态最稳定 |
| ACP SDK | @agentclientprotocol/sdk | 官方 TypeScript SDK |
| 前端框架 | React 19 | 已有高质量 UI 原型 |
| 前端构建 | Vite 8 | 已有配置 |
| 状态管理 | Zustand | 轻量、TS 友好 |
| 数据库 | better-sqlite3 | 零配置、嵌入式 |
| MCP SDK | @modelcontextprotocol/sdk | 官方 SDK |
| CLI | Commander | Node.js 标准 CLI 库 |
| 定时任务 | croner | 轻量 cron 解析器 |
| 配置校验 | Zod | TS 原生 schema 校验 |
| 日志 | pino | 高性能 JSON 日志 |
| 进程管理 | Node child_process | 原生，管理 ACP Agent 子进程 |
