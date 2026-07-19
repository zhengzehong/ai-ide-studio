# AI IDE Studio

> 以任务为中心、Agent 为主体的 AI 编程协作平台

AI IDE Studio 是一个本地部署的全栈 AI 编程协作工具。通过 [ACP（Agent Client Protocol）](https://github.com/anthropics/agentclientprotocol) 接入 Claude Code、Codex 等 AI Agent，实现任务管理、会话编排和人机协作。

## 功能

- **API + Runtime + Realtime 隔离** — API 提供 HTTP、领域命令与 DB Worker；Runtime 子进程拥有 ACP/终端/Session actor；Realtime 子进程负责 WebSocket、订阅、序列化和有界背压
- **Workspace** — 主工作台，支持流式对话、执行过程持久化/恢复、工具调用懒加载/折叠、ACP diff 文件变更查看、思考过程展示、图片附件、Markdown 渲染和长会话虚拟滚动
- **PC 项目切换** — 顶部支持固定项目 Tab，并显示所有项目的运行中/未读会话数；每个项目独立记忆上次页面、查询参数和关键视图状态，切回时先显示分区缓存并在后台同步最新数据
- **全局助理** — 可从 Agent 广场设置唯一全局 Agent，并通过右侧竖条随时打开独立聊天抽屉
- **移动端 Web App** — `/app/` 下提供手机浏览器访问的轻量客户端，支持远程连接、会话列表、对话、任务列表和设置页
- **Session 管理** — 会话按项目/Agent 归属展示，支持 Agent 显示/隐藏/删除、标题、重命名、复制、本地会话导入、关闭、归档和软删除
- **桌面悬浮部件** — Electron 常驻小窗口，按会话优先显示运行中/未读 Agent 会话进度，并支持快速查看和创建任务
- **Agent 运行时** — 支持 `mock`（本地开发）、`claude`（Claude Code）、`codex`（Codex）三种运行时
- **模型档案** — 在设置页维护 New API / OpenAI / Claude 供应商与 Claude Code、Codex 模型档案，并可为项目 Agent 绑定不同档案
- **ACP 功能** — 模型切换、模式切换（计划模式等）、权限请求、会话 Fork、上下文用量展示
- **会话运行偏好** — 每个 Session 会保留已切换的模型、模式和配置；重启服务或重连 ACP 后会自动恢复，Codex 默认 full access，Claude Code 默认 bypass permissions（可用时）
- **Task 管理** — 支持协作任务空壳 + 步骤编排、简单任务自动派发、对话任务化自认领、步骤汇报和状态追踪
- **事件中心** — 分类事件收件箱，支持项目作用域事件类别、Agent 写入事件、按 payload 字段订阅过滤、自动消费、指定/固定消费者会话，并可转成任务
- **Team MCP 协作** — 通过 `team.*` 工具创建团队、创建成员、派活、反馈和更新团队任务
- **Agent 会话通信** — 通过 `agent.*` 工具在非 Team Agent 会话之间发送消息、查看会话消息、要求回复和监听会话完成
- **A2A Hub 跨机器通信** — 通过 `agent_hub.*` 工具(`agent_hub.connect` / `agent_hub.disconnect` / `agent_hub.list` / `agent_hub.send`)接入外部 A2A Hub,让本地 Agent 跨机器互相调用;注册粒度为 (Agent, Session),`machineId` 持久化在本地 `settings` 表,SSE 混合传输,结果通过同一 SSE 通道自动回注入原会话;session 关闭自动断开 Hub 连接
- **知识库 LLM Wiki** — 每个项目自动拥有项目库，可挂载多个共享库；人和 AI 读写同一份 Markdown 页面，支持 `[[wikilink]]`、活动日志撤销、code 页面陈旧检测和显式 AI 刷新
- **规则引擎** — Cron 定时任务管理和事件触发规则，支持指定已有会话、每次新会话或固定新会话执行
- **MCP 工具平台** — 提供 `/mcp` HTTP MCP 入口，按 Session token 控制 Agent 可见的 `core.*` / `agent.*` / `team.*` 工具方法；Agent 可通过 `agent.template.*` 管理 Agent 广场模板，通过 `core.timeline.list` 读取会话时间线，通过 `studio.task.assign` 动态分派任务；`team.*` 默认不全局开放，可在工具管理页给 Agent 套用 Team 权限模板或单独开关方法
- **SQLite Worker 持久化** — 默认使用独立只读 Query Worker 和排队 Writer Worker；流式事件按会话有序批量提交，关键完成事件与 Outbox 原子写入，并支持从旧 JSON 格式自动迁移
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

PC 默认通过 `/api/v1` HTTP 读取任务、会话、消息历史和恢复事件。需要临时回滚时，在启动或构建 PC UI 前设置 `VITE_QUERY_TRANSPORT=ws`；移动端当前继续使用 WS 兼容 RPC。

PC 的 Prompt、取消、已读、权限和提问响应默认通过 `/api/v1/commands` HTTP 提交，并由 Writer 命令账本保证接收持久化和幂等；实时输出仍通过 WebSocket 订阅。需要临时回滚时设置 `VITE_COMMAND_TRANSPORT=ws`。

后端默认使用 `DATA_WORKER_MODE=worker`，同步 SQLite 查询和新会话热写分别运行在 Query/Writer Worker Thread。排障时可以显式设置 `DATA_WORKER_MODE=local` 回退到进程内适配器；Worker 运行中崩溃不会自动同步降级。

后端默认使用 `REALTIME_MODE=process` 启动独立 Realtime 子进程，API 同步阻塞不会占用实时连接事件循环。客户端通过 `/api/v1/realtime-config` 动态发现端点；排障时可显式设置 `REALTIME_MODE=embedded` 回退到 API 同端口 WebSocket。旧 WS 领域 RPC 默认通过本机 IPC 兼容桥执行，可在迁移完成后设置 `REALTIME_LEGACY_RPC=disabled` 关闭。

后端默认使用 `RUNTIME_SERVICE_MODE=process` 启动独立 Runtime 子进程。Claude/Codex ACP、每 Session 串行 actor、流更新合并、权限交互和终端资源都在该进程中；可见流通过专用本机管道直达 Realtime，持久化流回到 API/Writer。排障时可同时设置 `RUNTIME_SERVICE_MODE=embedded` 与 `REALTIME_MODE=embedded` 回滚到旧同进程路径。

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
├── src/           # API、Runtime、Realtime、IPC、Data Workers 与 ACP
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
npm run check:ui-bundle   # PC bundle 预算
npm run perf:phase5:smoke # 30 Session 性能 smoke
npm run perf:browser      # 生产构建浏览器性能门禁
```

## 尚未实现

- Gemini 运行时
- Memory/RAG 记忆系统
- 更完整的多 Agent 自动编排策略
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
| `DATA_WORKER_MODE` | `worker` | `worker` 使用 Query/Writer Worker；`local` 为显式同步回滚模式 |
| `DATA_WORKER_SLOW_MS` | `100` | Query/Writer Worker 请求总耗时达到该毫秒数时记录慢请求告警 |
| `DATA_MAINTENANCE_INTERVAL_MS` | `60000` | Writer SQLite 周期维护间隔 |
| `DATA_WAL_CHECKPOINT_BYTES` | `67108864` | 普通维护触发 PASSIVE WAL checkpoint 的字节阈值 |
| `DATA_PUBLISHED_OUTBOX_RETENTION_MS` | `604800000` | 已发布 Outbox 行保留时间；未发布行不会清理 |
| `EVENT_LOOP_MONITOR_INTERVAL_MS` | `30000` | API、Realtime、Runtime event-loop 指标采样间隔 |
| `EVENT_LOOP_WARN_THRESHOLD_MS` | `50` | event-loop p99 达到该毫秒数时记录告警 |
| `REALTIME_MODE` | `process` | `process` 使用独立 Realtime 子进程；`embedded` 为显式同进程回滚模式 |
| `REALTIME_HOST` | 与 `HOST` 一致 | Realtime 监听地址 |
| `REALTIME_PORT` | API 端口 + 1 | Realtime 监听端口；API 端口为 `0` 时也使用动态端口 |
| `REALTIME_LEGACY_RPC` | `enabled` | 是否允许旧 WS 领域 RPC 通过 IPC 转发到 API |
| `REALTIME_MAX_QUEUE_MESSAGES` | `500` | 单连接待发送消息上限 |
| `REALTIME_MAX_QUEUE_BYTES` | `2097152` | 单连接待发送队列字节上限 |
| `REALTIME_MAX_BUFFERED_BYTES` | `2097152` | 单 socket `bufferedAmount` 背压阈值 |
| `REALTIME_IPC_MAX_FRAME_BYTES` | `16777216` | 本机 Protobuf IPC 单帧上限 |
| `RUNTIME_SERVICE_MODE` | `process` | `process` 使用独立 Runtime 子进程；`embedded` 使用旧 `acpHost` 回滚适配器 |
| `RUNTIME_IPC_MAX_FRAME_BYTES` | `16777216` | Runtime 控制/持久化 IPC 单帧上限 |
| `RUNTIME_RESTART_DELAY_MS` | `250` | Runtime 异常退出后的监督重启延迟 |
| `ACP_RUNTIME_IDLE_MS` | `3600000` | ACP runtime 进程空闲停止时间 |
| `ACP_IDLE_SWEEP_MS` | `300000` | 空闲回收扫描间隔 |
| `GLOBAL_ASSISTANT_WORKSPACE_ROOT` | 系统应用数据目录下的 `global-assistants` | 全局助理工作空间根目录；实际工作目录为 `<root>/<agentId>/workspace` |

## ????????

AI IDE Studio ??????????????/??????? Agent ????? Agent ???????????????????????????????????????? MCP ????????????????????

?????

```text
???? -> Agent ?? -> ????? -> ??? -> ???? -> ??
```
