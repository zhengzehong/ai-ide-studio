# AI IDE Studio

> 以任务为中心、Agent 为主体的 AI 编程协作平台

AI IDE Studio 是一个本地部署的全栈 AI 编程协作工具。通过 [ACP（Agent Client Protocol）](https://github.com/anthropics/agentclientprotocol) 接入 Claude Code、Codex 等 AI Agent，实现任务管理、会话编排和人机协作。

## 功能

- **Gateway** — HTTP + WebSocket 服务，提供 Agent / Session / Task / Rule 的 RPC 接口和实时事件推送
- **Workspace** — 主工作台，支持流式对话、工具调用折叠、思考过程展示、图片附件、Markdown 渲染
- **Session 管理** — 会话按项目/Agent 归属展示，支持标题、重命名、关闭、归档和软删除
- **Agent 运行时** — 支持 `mock`（本地开发）、`claude`（Claude Code）、`codex`（Codex）三种运行时
- **ACP 功能** — 模型切换、模式切换（计划模式等）、权限请求、会话 Fork、上下文用量展示
- **Task 管理** — 创建任务、指派 Agent、状态追踪、自动流转（Session 完成后 Task 进入 reviewing）
- **Team MCP 协作** — 通过 `team.*` 工具创建团队、创建成员、派活、反馈和更新团队任务
- **规则引擎** — Cron 定时任务管理和事件触发规则
- **MCP 工具平台** — 提供 `/mcp` HTTP MCP 入口，按 Session token 控制 Agent 可见的 `core.*` / `team.*` 工具方法
- **SQLite 持久化** — 所有数据持久化到本地 SQLite，支持从旧 JSON 格式自动迁移
- **CLI** — 命令行管理工具（agents / sessions / tasks / rules / status）

## 快速开始

```bash
git clone https://github.com/zhengzehong/ai-ide-studio.git
cd ai-ide-studio
npm install
npm run dev:all    # 启动 Gateway + UI
```

- Web UI: http://localhost:5173
- Gateway: http://localhost:18800

详细配置见 [快速上手指南](docs/guides/getting-started.md)。

## 技术栈

| 后端 | 前端 |
|------|------|
| Hono + Node.js | Vite 8 + React 19 |
| WebSocket (ws) | Zustand |
| SQLite (better-sqlite3) | TypeScript 6 |
| ACP SDK | lucide-react |
| mitt 事件总线 | CSS Variables |

## 项目结构

```
ai-ide-studio/
├── src/           # 后端 Gateway（ACP + WS + SQLite）
├── ui/            # 前端 React 应用
├── tests/         # 测试（Vitest）
│   ├── unit/          # 单元测试
│   └── integration/   # 集成测试
├── scripts/       # 工具脚本
├── docs/          # 文档
│   ├── design/        # 设计文档
│   ├── architecture/  # 架构文档
│   └── guides/        # 开发指南
├── AGENTS.md      # AI Agent 开发规范
└── CONTRIBUTING.md # 贡献指南
```

## 开发命令

```bash
npm run dev          # 后端 Gateway（热重载）
npm run dev:ui       # 前端开发服务器
npm run dev:all      # 全栈开发
npm run build        # 生产构建
npm test             # 运行所有测试
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
```

## 尚未实现

- Gemini 运行时
- Memory/RAG 记忆系统
- 多 Agent 协作引擎
- 事件触发自动化
- 插件系统

## 文档

| 文档 | 说明 |
|------|------|
| [设计愿景](docs/design/vision.md) | 核心理念和产品方向 |
| [架构总览](docs/architecture/overview.md) | 当前系统架构 |
| [MCP 工具平台](docs/architecture/mcp-tool-platform.md) | HTTP MCP、方法级可见性、工具 token 和审计 |
| [数据模型](docs/architecture/data-model.md) | 实体、状态机、Schema |
| [WS 协议](docs/architecture/ws-protocol.md) | WebSocket RPC API |
| [快速上手](docs/guides/getting-started.md) | 环境搭建 |
| [测试指南](docs/guides/testing.md) | 测试编写和运行 |
| [贡献指南](CONTRIBUTING.md) | 代码规范和协作流程 |

## License

MIT



## Runtime 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `ACP_SESSION_IDLE_MS` | `1800000` | 单个 runtime 侧 ACP session 的空闲断开时间；保留 SQLite `acp_session_id` |
| `ACP_RUNTIME_IDLE_MS` | `3600000` | ACP runtime 进程空闲停止时间 |
| `ACP_IDLE_SWEEP_MS` | `300000` | 空闲回收扫描间隔 |

## ????????

AI IDE Studio ??????????????/??????? Agent ????? Agent ???????????????????????????????????????? MCP ????????????????????

?????

```text
???? -> Agent ?? -> ????? -> ??? -> ???? -> ??
```
