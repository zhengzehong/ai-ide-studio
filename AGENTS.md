# AI IDE Studio — Agent 开发指南

## 项目简介

AI IDE Studio 是一个 AI 编程协作平台，以 **任务为中心、Agent 为主体**，通过 ACP（Agent Client Protocol）接入 Claude Code / Codex 等 AI Agent，实现自主工作、协作和人机交互。

当前版本：**v0.2.0**（全栈可用，本地部署）。

## 技术栈

| 层面 | 选型 | 说明 |
|------|------|------|
| 后端框架 | **Hono** + **@hono/node-server** | HTTP API + 静态资源 |
| 实时通信 | **ws** | WebSocket RPC + 事件推送 |
| 数据库 | **better-sqlite3** | SQLite 持久化 |
| ACP 协议 | **@agentclientprotocol/sdk** | Agent 通信标准协议 |
| Agent 适配 | **claude-agent-acp** / **codex-acp** | Claude Code 和 Codex 运行时 |
| 事件总线 | **mitt** | 模块间解耦 |
| CLI | **commander** | 命令行管理工具 |
| 前端构建 | **Vite 8** | HMR 开发服务器 |
| UI 框架 | **React 19** + **TypeScript 6** | 函数组件 + Hooks |
| 状态管理 | **Zustand** | 轻量级前端状态 |
| 图标 | **lucide-react** | 统一图标体系 |
| 样式 | **CSS Variables** | 亮色主题，无 CSS 框架 |

## 目录结构

```
ai-ide-studio/
├── src/                    # 后端 Gateway
│   ├── entry.ts            # 主入口：初始化 DB → 启动 Gateway → 规则引擎
│   ├── acp/                # ACP 协议集成
│   │   ├── host.ts         # ACP Host 编排（核心，~950 行）
│   │   ├── adapters.ts     # 运行时适配器（mock/claude/codex）
│   │   ├── process.ts      # Agent 子进程管理
│   │   └── protocol.ts     # ACP 协议辅助
│   ├── core/               # 业务逻辑
│   │   ├── sessions.ts     # Session 生命周期
│   │   ├── tasks.ts        # Task 生命周期
│   │   ├── events.ts       # 事件总线（mitt 实例）
│   │   ├── rules.ts        # 规则引擎
│   │   ├── tool-calls.ts   # 工具调用合并逻辑
│   │   ├── config.ts       # 环境配置
│   │   └── cron.ts         # 定时任务
│   ├── gateway/            # HTTP + WebSocket 服务
│   │   ├── server.ts       # Hono HTTP 服务
│   │   └── ws-handler.ts   # WebSocket RPC 处理
│   ├── store/              # SQLite 持久层
│   │   ├── db.ts           # 数据库初始化和迁移
│   │   ├── agents.ts       # Agent CRUD
│   │   ├── sessions.ts     # Session/Message/Event CRUD
│   │   ├── tasks.ts        # Task CRUD
│   │   └── rules.ts        # Rule CRUD
│   └── types/
│       └── ws-protocol.ts  # WebSocket 消息类型定义
├── ui/                     # 前端 React 应用
│   └── src/
│       ├── pages/          # 页面组件
│       │   ├── Workspace.tsx   # 主工作台（对话/工具/计划）
│       │   ├── Dashboard.tsx   # 总览仪表板
│       │   ├── TaskBoard.tsx   # 任务看板
│       │   └── Schedule.tsx    # 定时任务 & 规则
│       ├── components/     # 可复用组件
│       ├── stores/         # Zustand 状态管理
│       ├── services/       # WebSocket 客户端
│       └── types/          # 前端类型定义
├── tests/                  # 测试
│   ├── unit/               # 纯函数/模块测试
│   └── integration/        # 需要 DB/WS 的集成测试
├── scripts/                # 工具脚本
├── docs/                   # 文档
│   ├── design/             # 设计文档（愿景/记忆模型/交互模式）
│   ├── architecture/       # 架构文档（随代码同步更新）
│   └── guides/             # 开发指南
└── package.json            # Monorepo 根配置（npm workspaces）
```

## 开发命令

```bash
npm install          # 安装所有依赖
npm run dev          # 启动后端 Gateway（热重载）
npm run dev:ui       # 启动前端开发服务器
npm run dev:all      # 同时启动后端 + 前端
npm run build        # 构建生产版本
npm test             # 运行所有测试
npm run test:unit    # 仅运行单元测试
npm run test:integration  # 仅运行集成测试
```

## 代码规范

### 通用规则

- 函数组件 + Hooks，不用 class 组件
- 所有面向用户的文本使用**中文**
- 命名：组件 PascalCase，文件 kebab-case，变量/函数 camelCase，DB 字段 snake_case
- 使用 named exports，避免 default export
- 单文件行数上限：后端 400 行，前端组件 300 行（超出则拆分）

### 后端规范

- ESM 模块，导入使用 `.js` 扩展名（TypeScript nodenext 解析）
- 模块间通过 mitt 事件总线通信，避免循环依赖
- 类型定义集中在 `src/types/ws-protocol.ts`

### 前端规范

- 样式优先使用 CSS 变量 + 内联样式，复杂布局用 CSS 文件
- 状态管理使用 Zustand store
- 类型定义在 `ui/src/types/index.ts`

### 测试规范

- 新功能必须有对应测试
- 测试使用 Vitest，文件命名 `xxx.test.ts`
- 纯函数测试放 `tests/unit/`，需要 DB/WS 的放 `tests/integration/`
- 修 bug 先写复现测试

## 设计原则

1. **亮色主题** — Cursor/Codex 风格，简洁专业
2. **AI 任务无百分比** — 用阶段描述（stage）代替进度条
3. **交互完整** — 所有按钮必须可点击，有对应动作
4. **中文界面** — 所有面向用户的文本均为中文

## 实体关系

```
Agent   1:N Session（Agent 管理多个会话）
Task    1:N Session（任务关联多个会话记录）
Task    N:1 Agent（任务可指派给一个主 Agent）
Session 1:N Event（事件溯源，append-only）
```

## AI 开发完成后的检查清单

每次完成功能开发后，必须检查：

- [ ] 新模块/文件 → 更新 `docs/architecture/overview.md` 目录映射
- [ ] 新 WS 方法 → 更新 `docs/architecture/ws-protocol.md`
- [ ] 新实体/状态 → 更新 `docs/architecture/data-model.md`
- [ ] 新功能 → 更新 `README.md` 功能列表
- [ ] 新功能 → 确保 `npm test` 覆盖
- [ ] API 变更 → 更新本文件中的类型路径

## 文档索引

| 文档 | 位置 | 说明 |
|------|------|------|
| 设计愿景 | `docs/design/vision.md` | 核心理念和产品方向 |
| 记忆模型 | `docs/design/memory-model.md` | Agent 记忆/RAG 设计 |
| 交互模式 | `docs/design/interaction-patterns.md` | 人机交互方式 |
| 架构总览 | `docs/architecture/overview.md` | 当前真实系统架构 |
| WS 协议 | `docs/architecture/ws-protocol.md` | WebSocket RPC API |
| 数据模型 | `docs/architecture/data-model.md` | 实体、状态机、DB Schema |
| 快速上手 | `docs/guides/getting-started.md` | 环境搭建和首次运行 |
| 开发规范 | `CONTRIBUTING.md` | 代码风格和协作流程 |
