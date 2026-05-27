# AI IDE Studio — Agent 开发指南

## 项目简介

AI IDE Studio 是一个 AI 编程协作平台，以 **任务为中心、Agent 为主体**，通过 ACP 协议接入 Claude Code / Codex 等 AI Agent。版本 **v0.2.0**，全栈可用，本地部署。

## 命令

```bash
npm install                  # 安装依赖
npm run dev                  # 后端 Gateway（热重载，端口 18800）
npm run dev:ui               # 前端 Vite（端口 5173）
npm run dev:all              # 全栈启动
npm run build                # 生产构建
npm test                     # 运行所有测试（Vitest）
npm run test:unit            # 仅单元测试
npm run test:integration     # 仅集成测试
npm run lint                 # ESLint 检查
npm run format               # Prettier 格式化
```

## 技术栈

| 层面 | 选型 |
|------|------|
| 后端 | Hono + ws + better-sqlite3 + Pino |
| ACP | @agentclientprotocol/sdk + claude-agent-acp + codex-acp |
| MCP | @modelcontextprotocol/sdk（内置工具桥接服务器） |
| 工具 | 可扩展工具注册表 + MCP 桥接 + ACP mcpServers 注入 |
| 事件 | mitt |
| 前端 | Vite 8 + React 19 + TypeScript 6 + Zustand |
| 样式 | CSS Variables，亮色主题 |

## 目录结构

```
src/                    # 后端 Gateway
├── entry.ts            # 主入口
├── acp/                # ACP 协议（host.ts 是核心）
├── core/               # 业务（sessions / tasks / events / logger）
├── gateway/            # HTTP + WS 服务
├── store/              # SQLite CRUD
├── tools/              # 可扩展工具系统
│   ├── types.ts        # 工具类型定义
│   ├── seed.ts         # 内置工具初始化
│   ├── resolver.ts     # 工具解析器（→ ACP McpServerStdio 扁平格式）
│   ├── mcp-server.ts   # 内置 MCP 桥接服务器（独立进程）
│   └── handlers/       # 内置工具实现（create-task / create-schedule）
└── types/              # WS 协议类型
ui/src/                 # 前端
├── pages/              # 页面组件（Workspace / Dashboard / TaskBoard / Schedule / ToolManager / AgentSquare / Settings）
├── components/         # 可复用组件
├── stores/             # Zustand 状态
├── services/           # WS 客户端
└── types/              # 前端类型
tests/                  # unit/ + integration/
scripts/                # 工具脚本
docs/                   # design/ + architecture/ + guides/
```

## 架构原则（AI 友好）

1. **垂直切片** — 按功能域组织（acp/ core/ gateway/ store/），不按技术层（controllers/ models/）
2. **局部推理** — 每个模块可独立理解，不需要加载整个系统到上下文
3. **小爆炸半径** — 修改一个模块不应波及其他模块，通过 mitt 事件总线解耦
4. **显式边界** — 模块间通过类型化接口通信，禁止跨层直接访问 DB
5. **自验证** — 每次改动后运行 `npm test` 确认，Agent 必须验证自己的工作

## 代码规范

### 文件

- 单文件上限：后端 **400 行**，前端组件 **300 行**，超出必须拆分
- 文件名 kebab-case，组件 PascalCase，变量/函数 camelCase，DB 字段 snake_case
- 使用 named exports，**禁止** default export
- 后端 ESM 导入使用 `.js` 扩展名

### 类型

- 后端类型：`src/types/ws-protocol.ts`
- 前端类型：`ui/src/types/index.ts`
- **禁止** `any`，使用 `unknown` + 类型守卫
- 函数参数和返回值必须有类型注解

### 前端

- 函数组件 + Hooks，**禁止** class 组件
- 样式用 CSS 变量 + 内联样式，复杂布局用 CSS 文件
- 所有用户可见文本使用**中文**

### 反模式（NEVER）

- **NEVER** 使用 `console.log` — 使用 `createChildLogger()`
- **NEVER** 在模块间直接 import store 的内部状态 — 通过事件总线或显式接口
- **NEVER** 在前端硬编码 WebSocket URL
- **NEVER** 提交含 `.env`、密码、token 的代码
- **NEVER** 写超过 400 行的后端文件而不拆分

## 日志规范

### 核心规则

使用 **Pino** 结构化 JSON 日志。所有后端模块**必须**使用日志，禁止 `console.log`。

```typescript
import { createChildLogger } from './core/logger.js'
const log = createChildLogger('模块名')

log.debug({ sessionId }, '开始处理 prompt')
log.info({ agentId, runtime }, 'Agent 启动成功')
log.warn({ sessionId, error: err.message }, 'ACP 会话重连')
log.error({ err, sessionId }, 'prompt 发送失败')
```

### 日志级别

| 级别 | 用途 | 示例 |
|------|------|------|
| `fatal` | 进程即将退出 | 数据库无法打开 |
| `error` | 操作失败，需要关注 | ACP 连接断开、WS 消息处理异常 |
| `warn` | 异常但可恢复 | 重试中、降级处理 |
| `info` | 关键业务节点 | 服务启动、Session 创建/关闭、Task 状态变更 |
| `debug` | 开发调试详情 | RPC 请求/响应、事件流细节、SQL 查询 |
| `trace` | 极细粒度 | 每条流式 chunk、原始 ACP 消息 |

### 必须打日志的场景

- 服务启动/关闭：端口、数据库路径、日志路径
- 每个 WS RPC 请求：type + requestId + 耗时
- Session 生命周期：create / prompt / done / close
- Task 状态变更：每次 status 切换
- ACP 通信：Agent 启动、初始化结果、错误
- DB 操作失败：所有 catch 块

### 日志上下文

每条日志必须包含足够的上下文用于排查：

```typescript
// GOOD — 有上下文，可搜索
log.info({ sessionId, agentId, taskId, elapsed: Date.now() - start }, 'prompt 处理完成')

// BAD — 无上下文，无法排查
log.info('done')
```

### 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LOG_LEVEL` | `debug` | 日志级别 |
| `LOG_DIR` | `./data/logs` | 日志文件目录 |

- **开发环境**：默认 `debug` 级别，控制台彩色输出 + 文件双写
- **生产环境**：建议 `info` 级别，JSON 标准输出 + 文件（14 天自动轮转）
- 日志文件路径：`data/logs/app.log`（按天轮转）

## 测试规范

- 新功能**必须**有测试，修 bug **先写复现测试**
- Vitest，文件名 `xxx.test.ts`
- 纯函数 → `tests/unit/`，需要 DB/WS → `tests/integration/`
- 提交前运行 `npm test` 确保全部通过

## 后续开发方式（必须遵守）

- 每次开始新需求前，先写任务清单；清单必须放到 `docs/superpowers/plans/`，并按清单顺序执行。
- 只做当前任务范围内的改动；如果出现新想法或新需求，先记入下一版，不要顺手扩。
- 任何跨后端 / 前端 / 文档的大改，必须先拆成更小的任务，再逐步完成。
- 后端新增 RPC、实体、状态或适配层时，优先下沉到专用模块，不要继续往入口文件和巨大 switch 里堆。
- 前端新增复杂界面时，先拆小组件，再组合回页面；不要把页面继续写成单文件大杂烩。
- ACP、工具系统、项目作用域有新能力时，先补 helper / adapter / store，再补 UI 展示，避免边界混乱。
- 每轮变更结束前，至少验证 `npm test`、`npm run build`、`npm run lint`；必要时再补 `git diff --check`。

## 完成检查清单

每次完成开发后，**必须**逐项检查：

- [ ] `npm test` 通过
- [ ] `npm run lint` 无新增错误
- [ ] 核心路径有日志覆盖（debug + info 级别）
- [ ] 新模块/文件 → 更新 `docs/architecture/overview.md`
- [ ] 新 WS 方法 → 更新 `docs/architecture/ws-protocol.md`
- [ ] 新实体/状态 → 更新 `docs/architecture/data-model.md`
- [ ] 新功能 → 更新 `README.md`

## 文档索引

| 文档 | 位置 |
|------|------|
| 架构总览 | `docs/architecture/overview.md` |
| 工具系统 | `docs/architecture/tool-system.md` |
| WS 协议 | `docs/architecture/ws-protocol.md` |
| 数据模型 | `docs/architecture/data-model.md` |
| 设计愿景 | `docs/design/vision.md` |
| 快速上手 | `docs/guides/getting-started.md` |
| 测试指南 | `docs/guides/testing.md` |
| 贡献指南 | `CONTRIBUTING.md` |
