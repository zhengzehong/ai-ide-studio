# AI IDE Studio

> 以任务为中心、Agent 为主体的 AI 编程协作平台

AI IDE Studio 是一个本地部署的全栈 AI 编程协作工具。通过 [ACP（Agent Client Protocol）](https://github.com/anthropics/agentclientprotocol) 接入 Claude Code、Codex 等 AI Agent，实现任务管理、会话编排和人机协作。

## 功能

- **Gateway** — HTTP + WebSocket 服务，提供 Agent / Session / Task / Rule 的 RPC 接口和实时事件推送
- **Workspace** — 主工作台，支持流式对话、执行过程持久化/恢复、工具调用懒加载/折叠、ACP diff 文件变更查看、思考过程展示、图片附件、Markdown 渲染和长会话虚拟滚动
- **全局助理** — 可从 Agent 广场设置唯一全局 Agent，并通过右侧竖条随时打开独立聊天抽屉
- **移动端 Web App** — `/app/` 下提供手机浏览器访问的轻量客户端，支持远程连接、会话列表、对话、任务列表和设置页
- **Session 管理** — 会话按项目/Agent 归属展示，支持 Agent 显示/隐藏/删除、标题、重命名、复制、本地会话导入、关闭、归档和软删除
- **桌面悬浮部件** — Electron 常驻小窗口，按会话优先显示运行中/未读 Agent 会话进度，并支持快速查看和创建任务
- **Agent 运行时** — 支持 `mock`（本地开发）、`claude`（Claude Code）、`codex`（Codex）三种运行时
- **模型档案** — 在设置页维护 New API / OpenAI / Claude 供应商与 Claude Code、Codex 模型档案，并可为项目 Agent 绑定不同档案
- **ACP 功能** — 模型切换、模式切换（计划模式等）、权限请求、会话 Fork、上下文用量展示
- **会话运行偏好** — 每个 Session 会保留已切换的模型、模式和配置；重启服务或重连 ACP 后会自动恢复，Codex 默认 full access，Claude Code 默认 bypass permissions（可用时）
- **Task 管理** — 创建任务、指派 Agent、状态追踪、指定/新建会话投递、自动流转（Session 完成后 Task 进入 reviewing）
- **事件中心** — 分类事件收件箱，支持项目作用域事件类别、Agent 写入事件、按 payload 字段订阅过滤、自动消费、指定/固定消费者会话，并可转成任务
- **Team MCP 协作** — 通过 `team.*` 工具创建团队、创建成员、派活、反馈和更新团队任务
- **Agent 会话通信** — 通过 `agent.*` 工具在非 Team Agent 会话之间发送消息、查看会话消息、要求回复和监听会话完成
- **A2A Hub 跨机器通信** — 通过 `agent_hub.*` 工具(`agent_hub.connect` / `agent_hub.disconnect` / `agent_hub.list` / `agent_hub.send`)接入外部 A2A Hub,让本地 Agent 跨机器互相调用;注册粒度为 (Agent, Session),`machineId` 持久化在本地 `settings` 表,SSE 混合传输,结果通过同一 SSE 通道自动回注入原会话;session 关闭自动断开 Hub 连接
- **知识库 LLM Wiki** — 每个项目自动拥有项目库，可挂载多个共享库；人和 AI 读写同一份 Markdown 页面，支持 `[[wikilink]]`、活动日志撤销、code 页面陈旧检测和显式 AI 刷新
- **规则引擎** — Cron 定时任务管理和事件触发规则，支持指定已有会话、每次新会话或固定新会话执行
- **MCP 工具平台** — 提供 `/mcp` HTTP MCP 入口，按 Session token 控制 Agent 可见的 `core.*` / `agent.*` / `team.*` 工具方法；Agent 可通过 `agent.template.*` 管理 Agent 广场模板，通过 `core.timeline.list` 读取会话时间线，通过 `studio.task.assign` 动态分派任务；`team.*` 默认不全局开放，可在工具管理页给 Agent 套用 Team 权限模板或单独开关方法
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
- Mobile UI: http://localhost:5174/app/（开发）或 http://localhost:18800/app/（生产构建后）
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
├── mobile/        # 移动端 React 应用（/app/）
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
npm run dev:mobile   # 移动端开发服务器
npm run dev:all      # 全栈开发
npm run build        # 生产构建（后端 + PC 端 + 移动端）
npm run build:mobile # 仅构建移动端
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
| [事件中心设计](docs/design/event-center.md) | 事件收件箱、类别、订阅和 Agent 消费模型 |
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
| `GLOBAL_ASSISTANT_WORKSPACE_ROOT` | 系统应用数据目录下的 `global-assistants` | 全局助理工作空间根目录；实际工作目录为 `<root>/<agentId>/workspace` |

## ????????

AI IDE Studio ??????????????/??????? Agent ????? Agent ???????????????????????????????????????? MCP ????????????????????

?????

```text
???? -> Agent ?? -> ????? -> ??? -> ???? -> ??
```
