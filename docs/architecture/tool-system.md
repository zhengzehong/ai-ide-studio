# 可扩展工具系统架构设计

## 核心问题

当前系统中 Agent（Claude Code / Codex）自带内部工具（读文件、执行命令等），
但宿主（AI IDE Studio）**没有**向 Agent 注入自定义工具的能力。

ACP 协议的标准方式是通过 **MCP 服务器** 向 Agent 提供外部工具：

```
Agent ──ACP──→ Host
                ├── 内置能力: fs / terminal / permission / elicitation
                └── MCP 服务器: mcpServers[] (创建 Session 时传入)
                     ├── 浏览器工具 (playwright-mcp)
                     ├── 定时任务工具 (内置)
                     ├── 搜索工具 (内置)
                     └── 用户自定义工具 ...
```

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                       Tool Registry (DB)                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ MCP 外部服务  │  │ 内置工具      │  │ 脚本工具     │         │
│  │              │  │              │  │              │         │
│  │ command/args │  │ TS 函数实现   │  │ 用户 JS/TS   │         │
│  │ (独立进程)    │  │ (MCP 桥接)    │  │ (沙箱执行)   │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         └──────────────────┼──────────────────┘                 │
│                            ▼                                    │
│              ┌─────────────────────────┐                        │
│              │  Tool Resolver          │                        │
│              │  按 agent / project     │                        │
│              │  解析可用工具集          │                        │
│              └────────────┬────────────┘                        │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                   │
│         ▼                 ▼                 ▼                   │
│   ┌──────────┐    ┌──────────────┐   ┌──────────────┐          │
│   │ 外部 MCP │    │ 内置 MCP     │   │ 脚本 MCP     │          │
│   │ 服务进程  │    │ 桥接服务器    │   │ 沙箱服务器   │          │
│   └────┬─────┘    └──────┬───────┘   └──────┬───────┘          │
│        └─────────────────┼──────────────────┘                   │
│                          ▼                                      │
│              ┌──────────────────────┐                            │
│              │ ACP Session 创建     │                            │
│              │ mcpServers: [...]    │                            │
│              └──────────┬───────────┘                            │
│                         │                                       │
│                         ▼                                       │
│              Agent 可使用所有注入的工具                           │
└─────────────────────────────────────────────────────────────────┘
```

## 工具类型

### 1. MCP 外部服务 (`type: 'mcp'`)

引用独立的 MCP 服务器进程（如 `@playwright/mcp`、`@modelcontextprotocol/server-filesystem` 等）。

```json
{
  "type": "mcp",
  "config": {
    "command": "npx",
    "args": ["@playwright/mcp@latest"],
    "env": { "DISPLAY": ":0" },
    "transport": "stdio"
  }
}
```

### 2. 内置工具 (`type: 'builtin'`)

平台内置的工具函数，通过内部 MCP 桥接服务器暴露给 Agent。

```json
{
  "type": "builtin",
  "config": {
    "handler": "createTask"
  }
}
```

内置工具实现在 `src/tools/handlers/` 目录，每个工具一个文件：

| 工具 | handler | 说明 |
|------|---------|------|
| 创建任务 | `createTask` | 通过 API 创建 Task |
| 创建定时任务 | `createScheduledTask` | 创建 cron 规则 |
| 搜索文件 | `searchFiles` | 在项目目录中搜索 |
| 获取项目信息 | `getProjectInfo` | 返回项目元信息 |
| 列出 Agent | `listAgents` | 查询 Agent 列表 |
| HTTP 请求 | `httpFetch` | 发起 HTTP 请求 |

### 3. 脚本工具 (`type: 'script'`)

用户编写的 JS/TS 脚本，遵循标准接口：

```typescript
// tools/my-custom-tool.ts
import type { ToolHandler } from 'ai-ide-studio/tool-sdk'

export default {
  name: 'my_custom_tool',
  description: '我的自定义工具',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '查询内容' },
    },
    required: ['query'],
  },
  async execute(input: { query: string }) {
    return { result: `处理: ${input.query}` }
  },
} satisfies ToolHandler
```

## 工具定义规范 (Tool Specification)

```typescript
interface ToolDefinition {
  id: string
  name: string                     // 英文标识符，如 'browser', 'create_task'
  displayName: string              // 中文显示名，如 '浏览器', '创建任务'
  description: string              // 工具描述（传给 Agent）
  category: ToolCategory
  type: 'builtin' | 'mcp' | 'script'
  config: BuiltinConfig | McpConfig | ScriptConfig
  inputSchema?: object             // JSON Schema
  permissions: ToolPermissions
  enabled: boolean
  isBuiltin: boolean
}

type ToolCategory = 'browser' | 'filesystem' | 'network' | 'automation' | 'code' | 'data' | 'custom'

interface McpConfig {
  command: string                  // 启动命令
  args: string[]                   // 启动参数
  env?: Record<string, string>     // 环境变量
  transport: 'stdio' | 'sse'      // 传输方式
}

interface BuiltinConfig {
  handler: string                  // 内置处理函数名
}

interface ScriptConfig {
  scriptPath: string               // 脚本文件路径
  runtime: 'node' | 'bun'         // 执行运行时
  timeout?: number                 // 超时 ms
}

interface ToolPermissions {
  requiresApproval: boolean        // 是否需要用户确认
  allowedPaths?: string[]          // 文件系统沙箱
  maxExecutionTime: number         // 最大执行时间 ms
  networkAccess: boolean           // 是否允许网络
}
```

## 工具绑定模型

```
                  global (所有 Agent 默认可用)
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
    project A    project B    project C
        │            │
    ┌───┴───┐    ┌───┴───┐
    ▼       ▼    ▼       ▼
 agent1  agent2  agent3  agent4
```

工具解析优先级：`agent 级别` > `project 级别` > `global 级别`

```typescript
interface ToolBinding {
  id: string
  toolId: string
  scope: 'global' | 'project' | 'agent'
  targetId: string | null      // null for global
  enabled: boolean             // 可在绑定层级禁用
  configOverride?: object      // 覆盖默认配置
}
```

## 数据库 Schema

```sql
CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  input_schema_json TEXT,
  permissions_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tool_bindings (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_override_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tool_id, scope, target_id)
);
```

## ACP 集成流程

### Session 创建时注入工具

```typescript
// src/acp/host.ts — newSession 修改
async newSession(agentId: string, ourSessionId: string, projectId?: string) {
  const conn = this.agents.get(agentId)

  // 解析此 Agent + Project 可用的工具集
  const tools = toolRegistry.resolveTools(agentId, projectId)

  // 转换为 ACP mcpServers 格式
  const mcpServers = tools.map(t => toolToMcpServer(t))

  const result = await conn.connection.newSession({
    cwd: process.cwd(),
    mcpServers,
  })

  return result.sessionId
}
```

### MCP Server 格式

```typescript
function toolToMcpServer(tool: ResolvedTool): acp.McpServer {
  if (tool.type === 'mcp') {
    // 外部 MCP 服务器：直接传递
    return {
      name: tool.name,
      transport: {
        type: 'stdio',
        command: tool.config.command,
        args: tool.config.args,
        env: tool.config.env,
      },
    }
  }
  // 内置 + 脚本工具：统一走内部 MCP 桥接
  // 由 built-in MCP server 统一暴露
  return {
    name: 'ai-ide-studio-tools',
    transport: {
      type: 'stdio',
      command: process.execPath,
      args: ['--import', 'tsx', 'src/tools/mcp-server.ts'],
      env: { TOOL_IDS: resolvedBuiltinIds.join(',') },
    },
  }
}
```

## 内置 MCP 桥接服务器

`src/tools/mcp-server.ts` — 一个标准 MCP 服务器进程，暴露所有激活的内置/脚本工具：

```typescript
// 伪代码
const server = new McpServer({ name: 'ai-ide-studio-tools' })

// 注册所有激活的内置工具
for (const tool of getActiveBuiltinTools()) {
  server.tool(tool.name, tool.description, tool.inputSchema, tool.execute)
}

server.run(process.stdin, process.stdout)
```

## 目录结构

```
src/tools/
├── resolver.ts              # 工具解析器（按 agent/project 解析 → ACP McpServerStdio 格式）
├── mcp-server.ts            # 内置 MCP 桥接服务器（独立进程）
├── seed.ts                  # 内置工具初始化
├── types.ts                 # 工具类型定义
└── handlers/                # 内置工具实现
    ├── index.ts             # handler 注册表
    ├── create-task.ts       # 创建任务
    └── create-schedule.ts   # 创建定时任务
```

## WS API

| 方法 | 说明 |
|------|------|
| `tools.list` | 列出所有工具 |
| `tools.get` | 获取工具详情 |
| `tools.create` | 创建自定义工具 (mcp/script) |
| `tools.update` | 更新工具配置 |
| `tools.delete` | 删除工具（仅非内置） |
| `tools.test` | 测试工具执行 |
| `tool-bindings.list` | 列出绑定 |
| `tool-bindings.set` | 设置绑定（global/project/agent） |
| `tool-bindings.remove` | 移除绑定 |

## 内置工具清单

| 名称 | category | 说明 | 默认绑定 |
|------|----------|------|----------|
| `create_task` | automation | 创建任务并分派 Agent | global |
| `create_schedule` | automation | 创建 cron 定时规则 | global |
| `browser` | browser | Playwright 浏览器自动化（MCP 外部服务） | 按需绑定 |

## 实施顺序

1. **Phase 1: 核心框架**
   - 工具类型定义 (`src/tools/types.ts`)
   - 数据库 schema (tools + tool_bindings)
   - 工具注册表 (`src/tools/registry.ts`)
   - 工具解析器 (`src/tools/resolver.ts`)
   - Seed 内置工具定义

2. **Phase 2: 内置工具实现**
   - 实现 6 个内置工具 handler
   - MCP 桥接服务器 (`src/tools/mcp-server.ts`)

3. **Phase 3: ACP 集成**
   - 修改 `host.ts` 的 `newSession()` 注入 mcpServers
   - 传递 projectId 到 session 创建流程

4. **Phase 4: 前端 UI**
   - 工具管理页面（工具列表 + 创建/编辑）
   - 工具绑定配置（Agent/Project 级别切换）
   - 导航中新增"工具"入口

5. **Phase 5: 高级功能**
   - 脚本工具支持（用户上传/编写）
   - 工具执行日志和监控
   - 工具市场（共享工具模板）

---

## 中期实现更新：Tool Gateway MCP Server

本次中期改造把 `builtin` 和 `script` 工具统一聚合到一个稳定的 MCP Server：`ai-ide-tool-gateway`。

### 新的数据流

```text
Tool Registry / DB
        ↓
resolveToolsForSession(agentId, projectId)
        ↓
resolveToolsAsMcpServers()
        ↓
┌──────────────────────────────┐
│ type=mcp      继续外部直通     │
│ builtin/script 走 Tool Gateway │
└──────────────────────────────┘
        ↓
ACP newSession({ mcpServers })
```

### 稳定入口

- 真实实现：`src/tools/tool-gateway.ts`
- 兼容旧入口：`src/tools/mcp-server.ts`
- build 后优先走：`dist/tools/tool-gateway.js`
- 开发态走：`node --import tsx src/tools/tool-gateway.ts`

Resolver 生成的 Gateway MCP 配置类似：

```ts
{
  name: 'ai-ide-tool-gateway',
  command: process.execPath,
  args: ['dist/tools/tool-gateway.js'],
  env: [
    { name: 'TOOL_IDS', value: 'tool-a,tool-b' },
    { name: 'PROJECT_ID', value: projectId },
    { name: 'AGENT_ID', value: agentId },
    { name: 'DATA_DIR', value: dataDir },
  ],
}
```

### Script Tool 约定

脚本工具目前支持 `runtime: 'node'`，脚本可导出默认函数或 `execute` 函数：

```ts
export default async function(input, context) {
  return `hello ${input.name}`
}
```

```ts
export async function execute(input, context) {
  return { content: [{ type: 'text', text: 'ok' }] }
}
```

返回值归一化规则：

- 已是 `{ content: [{ type: 'text', text }] }`：原样返回。
- 字符串：包装为 MCP text content。
- 其他 JSON 值：格式化为 JSON text content。
- 抛错、超时、文件不存在：返回 `isError: true`。

### 权限与执行保护

Gateway 在执行前统一做基础权限检查：

- `requiresApproval: true`：默认阻止执行，返回明确错误。
- `allowedPaths`：`scriptPath` 必须位于允许目录内。
- `maxExecutionTime` / `config.timeout`：script 执行超时保护。

外部 MCP 目前仍保持直通，不通过 Gateway 代理；后续如果要统一审计外部 MCP，可在下一阶段扩展为 MCP proxy。

### 覆盖测试

- `tests/unit/tool-gateway-resolver.test.ts`
- `tests/unit/tool-permission-guard.test.ts`
- `tests/unit/script-runner.test.ts`
- `tests/integration/tool-gateway-script.test.ts`
- `tests/integration/tool-gateway-mcp.test.ts`
