# 务实实现方案
## Current implementation boundary (2026-05-27)
- Real Agent runtimes currently exposed by this repository are `mock`, `claude`, and `codex`.
- Gemini is not connected yet; any Gemini references in older architecture examples are future-target notes, not current capability.
- Memory/RAG, true Multi-Agent collaboration, and event-triggered automation are future capabilities.
- SQLite persistence is active via `better-sqlite3`; legacy JSON `data/ai-ide.db` is migrated into `data/ai-ide.sqlite` when present.
> 砍掉过度设计，保留核心思路，能实际落地的方案。
## 一、设计原则
```
1. 先跑通再抽象   — 不预先搭插件系统，先用普通模块
2. 渐进式可扩展   — 目录结构留好位置，但不提前写框架
3. 性能友好       — 不全放内存，流式转发，不缓冲
4. AI 通过 CLI/MCP — 不做 HTTP API 给 AI，做 CLI 命令和 MCP 工具
```
## 二、架构简化
### 对比
```
07 文档的架构（过度设计）          本方案（务实版）
─────────────────────           ─────────────────────
微内核                           直接模块 import
  EventBus                        简单事件（mitt，100行库）
  ServiceRegistry                 不需要，直接引用
  PluginManager + 四层加载         不需要，import 就行
  ConfigManager + 热重载           dotenv + 简单 JSON 读取
10 个独立插件                      普通 TS 模块按目录组织
  每个有 manifest + setup          每个就是 export 的函数/类
完整 CLI（几十个命令）              5-6 个核心命令
WS RPC + HTTP REST + CLI + MCP    WS（给UI）+ CLI/MCP（给AI）
```
### 实际架构
```
┌─────────────────────────────────────────────┐
│                 Web UI (React)               │
│                 浏览器里跑                    │
└──────────────────┬──────────────────────────┘
                   │ WebSocket
┌──────────────────▼──────────────────────────┐
│              Gateway 进程 (Node.js)          │
│                                             │
│   ┌─────────┐  ┌────────┐  ┌─────────────┐ │
│   │ WS 层   │  │ HTTP   │  │   CLI 入口  │ │
│   │ (给 UI) │  │ (静态) │  │  (给 AI/人) │ │
│   └────┬────┘  └────────┘  └──────┬──────┘ │
│        │                          │         │
│   ┌────▼──────────────────────────▼──────┐  │
│   │              核心模块                 │  │
│   │                                      │  │
│   │  acp-host     ← Agent 进程管理       │  │
│   │  sessions     ← Session 生命周期     │  │
│   │  tasks        ← 任务状态机           │  │
│   │  tools        ← 工具注册 + 执行      │  │
│   │  store        ← persistence 持久化        │  │
│   │  events       ← mitt 事件（轻量）    │  │
│   └──────────────────┬───────────────────┘  │
│                      │ stdio                │
│   ┌──────────────────▼───────────────────┐  │
│   │         ACP Agent 子进程              │  │
│   │   Claude / Codex / Mock      │  │
│   └──────────────────────────────────────┘  │
│                                             │
│   ┌──────────────────────────────────────┐  │
│   │         MCP Server 模式              │  │
│   │   暴露 create_task / list_sessions   │  │
│   │   等工具给外部 AI Agent 用           │  │
│   └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```
## 三、AI 怎么用我们
### 3.1 CLI 命令（最直接）
AI Agent 天生有 bash/exec 工具，直接调我们的 CLI：
```bash
# 基本操作
ai-ide status                              # 系统状态
ai-ide agents list                         # 列出 Agent
ai-ide agents start claude                 # 启动 Claude Agent
# Session 操作
ai-ide sessions list                       # 列出活跃 Session
ai-ide sessions create --agent claude      # 创建 Session
ai-ide prompt <session-id> "重构 auth"      # 发消息给 Agent
ai-ide sessions close <session-id>         # 关闭
# 任务操作
ai-ide tasks list                          # 列出任务
ai-ide tasks create "实现支付接口"          # 创建任务
ai-ide tasks assign <task-id> claude       # 分派
# 全部命令输出 JSON，AI 友好
ai-ide agents list --json
```
### 3.2 MCP Server 模式（标准化接入）
```bash
# 启动 MCP 服务
ai-ide mcp serve
```
注册为 MCP 工具后，任何 AI Agent 的 MCP 配置里加上：
```jsonc
{
  "mcpServers": {
    "ai-ide-studio": {
      "command": "ai-ide",
      "args": ["mcp", "serve"]
    }
  }
}
```
暴露的 MCP 工具：
```
create_task      — 创建任务
assign_task      — 分派任务给 Agent
list_tasks       — 列出任务
list_agents      — 列出 Agent 及状态
create_session   — 创建 Agent Session
send_prompt      — 给 Agent Session 发消息
list_sessions    — 列出活跃 Session
get_session_log  — 获取 Session 历史
resolve_decision — 回复 Agent 的决策请求
```
### 3.3 WebSocket（只给 Web UI）
浏览器是唯一需要实时推送的客户端，WS 只给它用。
## 四、目录结构（简化版）
```
ai-ide-studio/
│
├── src/                           # 核心引擎
│   ├── entry.ts                   # 程序入口
│   │
│   ├── acp/                       # ACP 主机
│   │   ├── host.ts                # Agent 连接管理
│   │   ├── process.ts             # 子进程生命周期
│   │   └── adapters.ts            # Claude/Codex/Mock; Gemini future 启动配置
│   │
│   ├── core/                      # 核心逻辑
│   │   ├── sessions.ts            # Session 管理
│   │   ├── tasks.ts               # Task 状态机
│   │   ├── tools.ts               # Tool 注册表
│   │   ├── events.ts              # mitt 事件总线（很小）
│   │   └── config.ts              # 配置加载
│   │
│   ├── gateway/                   # 网络层
│   │   ├── server.ts              # HTTP + WS 启动
│   │   ├── ws-handler.ts          # WS 消息处理
│   │   └── static.ts              # 静态文件托管（Web UI）
│   │
│   ├── store/                     # 存储
│   │   ├── db.ts                  # SQLite 初始化
│   │   ├── agents.ts              # Agent 表
│   │   ├── sessions.ts            # Session + Message 表
│   │   └── tasks.ts               # Task 表
│   │
│   ├── cli/                       # CLI 命令
│   │   ├── index.ts               # Commander 入口
│   │   ├── agents.ts              # agents 子命令
│   │   ├── sessions.ts            # sessions 子命令
│   │   ├── tasks.ts               # tasks 子命令
│   │   └── mcp.ts                 # mcp serve 子命令
│   │
│   └── types/                     # 共享类型（前后端都用）
│       ├── agent.ts
│       ├── session.ts
│       ├── task.ts
│       ├── chat.ts
│       ├── ws-protocol.ts         # WS 消息类型
│       └── index.ts
│
├── ui/                            # Web 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── stores/                # Zustand
│       │   ├── agent.store.ts
│       │   ├── session.store.ts
│       │   ├── task.store.ts
│       │   └── connection.store.ts
│       ├── services/
│       │   └── ws-client.ts       # WS 连接
│       ├── components/            # 现有组件迁移
│       └── pages/                 # 现有页面迁移
│
├── skills/                        # Skill 模板（后期）
├── tools/                         # 辅助工具
│   └── acp_host_py/               # Python CLI（后期）
│
├── docs/
├── package.json                   # workspace 根
├── tsconfig.json
├── config.example.json
├── .env.example
├── AGENTS.md
└── README.md
```
### 4.1 文件数量对比
| 方案 | 预估文件数 | 复杂度 |
|------|-----------|--------|
| 07 文档（微内核 + 10 插件） | ~80-100 个 | 过度 |
| **本方案（直接模块）** | **~35-40 个** | 合适 |
| 当前（纯前端原型） | 14 个 | — |
从 14 到 40 是合理的增长。从 14 到 100 就跳太猛了。
## 五、性能设计（支持 50+ Agent 并发）
### 5.0 语言选择依据
```
产品调研结论：
  Claude Code   = TypeScript (Bun)    512K 行，至今没换
  Codex CLI     = Rust（从 TS 重写）   重写原因是零依赖安装 + 内核沙箱
  OpenCode      = Go
  OpenClaw      = TypeScript (Node)   7000+ 文件，生产运行
选择 TypeScript 的原因：
  1. 50 Agent 的瓶颈不在主进程语言（瓶颈在子进程内存和 LLM API 限流）
  2. 主进程只做 I/O 转发，Node.js/libuv 处理几万 fd 没问题
  3. Python 的 asyncio 并发模型跟 Node.js 一样，但 JSON 解析慢 5-10x
  4. Rust 性能最好但开发时间 10x，Claude Code 512K 行都没换 Rust
  5. ACP TypeScript SDK 最成熟（2.8M 周下载，Zed 官方维护）
```
### 5.1 50 Agent 的真实负载
```
50 个 ACP Agent = 50 个 OS 子进程（各自独立运行）
同一时刻：
  ~30 个在等 LLM API 响应（空闲，不输出）
  ~10 个在执行工具/等 I/O（偶尔输出）
  ~5-10 个在流式输出文本（高频输出）
主进程实际处理的流量：
  10 路活跃流 × 5KB/s = 50KB/s
  Node.js JSON.parse 速度 ≈ 100MB/s
  → CPU 占用 < 0.1%，完全不是瓶颈
```
### 5.2 内存设计
```
原则：主进程轻量，重活在子进程，历史在磁盘
主进程内存（固定）：
  Gateway + 事件循环          ≈ 50MB
  SQLite 连接 + WAL 缓存     ≈ 20MB
  Agent 连接元数据 × 50       ≈ 5MB（每个 ~100KB：状态/配置/pipe引用）
  WS 客户端连接 × 10          ≈ 2MB
  活跃 Session 消息缓存       ≈ 按需加载，不全放内存
  合计                        ≈ ~80MB
子进程内存（不可控，独立的）：
  Claude Code ACP  × N       ≈ 100-200MB × N
  Codex ACP (Rust) × M       ≈ 30-50MB × M
50 Agent 子进程总计           ≈ 3-8GB（取决于 Agent 类型组合）
```
**结论：主进程 80MB 没问题。瓶颈是机器 RAM 能不能撑住 50 个子进程。**
16GB RAM 的机器跑 50 个 Agent 会吃紧，32GB 够用。
### 5.3 关键设计原则
**a) 流式直通（Stream-Through）**
```
✅ 正确做法：
  Agent stdout → 逐帧解析 NDJSON → 立即转发 WS → 异步写 SQLite
❌ 错误做法：
  Agent stdout → 缓冲完整回复 → 存数据库 → 查数据库 → 发 WS
区别：
  正确做法延迟 = 1-5ms（解析 + 转发）
  错误做法延迟 = 50-200ms（数据库往返）
```
**b) 订阅制 WS 推送**
```
❌ 广播模式（OpenClaw 的问题之一）：
  每条消息 → 发给所有 WS 客户端 → 客户端自己过滤
  50 Agent 流 × 3 WS 客户端 = 150 路无用消息
✅ 订阅模式：
  WS 客户端发送 subscribe { sessionIds: ['s-001', 's-002'] }
  只推送客户端正在看的 Session 的消息
  切换页面时 unsubscribe 旧的 + subscribe 新的
  
  50 Agent 流 → 只转发 2-3 个被订阅的 → 99% 的消息不过 WS
```
**c) Session 消息懒加载**
```
❌ 全放内存：
  50 Session × 500 条消息 × 2KB = 50MB 内存（还在增长）
✅ 懒加载：
  内存中只有 Agent 连接元数据（状态/配置）
  消息历史全在 SQLite
  用户打开 Session → 从 SQLite 加载最近 50 条
  新消息 → 流式直通到 WS + 异步写 SQLite
  用户滚动翻页 → 再从 SQLite 加载
```
**d) SQLite WAL 模式**
```
50 路并发写入不会冲突：
SQLite WAL (Write-Ahead Logging) 模式：
  - 多读者 + 单写者同时工作
  - 写入不阻塞读取
  - 适合"大量写 + 偶尔读"的消息流场景
  
启用方式：
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
```
### 5.4 默认限制（可配置）
```typescript
const LIMITS = {
  maxAgentProcesses: 50,     // 最多 50 个 Agent 子进程
  maxActiveSessions: 100,    // 最多 100 个活跃 Session
  maxWsClients: 10,          // 最多 10 个 Web UI 连接
  wsSubscriptionLimit: 20,   // 每个 WS 客户端最多订阅 20 个 Session
  messagePageSize: 50,       // 消息分页大小
  agentStartTimeout: 30_000, // Agent 启动超时 30s
  agentIdleTimeout: 600_000, // Agent 空闲 10 分钟自动休眠
}
```
### 5.5 Agent 生命周期优化
```
50 个 Agent 不需要全部常驻进程：
进程状态：
  running  — 有活跃 Session，进程在跑
  idle     — 无活跃 Session，进程在跑但空闲
  sleeping — 进程已 kill，Session 数据在 SQLite，可恢复
  
自动策略：
  Agent 空闲 10 分钟 → 自动 sleeping（kill 进程，释放内存）
  用户打开该 Agent 的 Session → 自动唤醒（重新 spawn + ACP session/resume）
  
效果：
  50 个 Agent 配置 → 实际常驻进程可能只有 5-15 个
  其他都在 sleeping，需要时秒级唤醒
  
ACP 原生支持 session/resume，这不是 hack，是协议设计好的功能
```
### 5.6 如果还是遇到瓶颈（渐进升级路径）
```
Level 0（当前方案）：
  主线程直接处理 50 个 stdio pipe
  单 SQLite 实例，WAL 模式
  订阅制 WS 推送
  → 预计支撑 50 Agent + 100 Session 无问题
Level 1（有症状时）：
  Worker Thread 处理 JSON 解析
  SQLite 批量写入（累积 100ms 的消息一次性写）
  → 预计支撑 200 Agent
Level 2（真的需要时）：
  Agent 子进程通过 Unix Socket 而非 stdio
  主进程 Cluster 模式（多核）
  从 SQLite 升级到 PostgreSQL
  → 这时候可能已经是商业产品了
Level 3（极端场景）：
  Agent 管理进程用 Rust 重写（只做 stdio → WS 转发）
  Node.js 只做 HTTP/WS/业务逻辑
  → 类似 Codex 的路径，但只重写性能敏感部分
```
## 六、核心数据流（最小可行）
### 6.1 用户发消息
```
用户输入框 → WS 发送 { type:'prompt', sessionId, content }
                │
Gateway ws-handler.ts 接收
                │
sessions.ts 找到对应 Session
                │
acp/host.ts 调用 connection.prompt()
                │
ACP Agent 进程收到 session/prompt
                │
Agent 开始流式回复 session/update（多次）
                │
acp/host.ts 收到每一帧 → events.emit('session:update')
                │
ws-handler.ts 监听事件 → WS 转发 { type:'session_update', data }
                │
前端 stores 更新 → React 重渲染消息列表
                │
同时：store/sessions.ts 异步写入 persistence
```
### 6.2 AI Agent 通过 CLI 创建任务
```
AI Agent (Claude Code) 执行：
  bash("ai-ide tasks create '实现退款API' --assign dev-beta --json")
                │
cli/tasks.ts 解析命令
                │
  ─── 如果 Gateway 在跑 ───
  │  CLI 连接本地 WS → 发送 tasks.create
  │  Gateway 处理 → 结果返回
  │
  ─── 如果 Gateway 没跑 ───
     直接操作 SQLite → 返回结果
stdout 输出 JSON → AI Agent 拿到结构化结果
```
### 6.3 MCP 工具调用
```
外部 AI Agent → MCP Client → stdio → 我们的 MCP Server 进程
                                        │
cli/mcp.ts 启动 MCP Server
  用 @modelcontextprotocol/sdk
  注册工具：create_task / list_sessions / send_prompt / ...
                                        │
MCP Server 连接本地 Gateway WS
  或直接操作 SQLite（Gateway 没跑时）
                                        │
工具执行结果 → MCP 响应 → 外部 AI Agent
```
## 七、实现顺序
### Phase 1：核心引擎 (Week 1)
目标：能启动 Gateway，WS 能跑，CLI 基本命令能用
```
做什么：
  ✓ src/entry.ts — 入口
  ✓ src/core/config.ts — 读 .env + config.json
  ✓ src/core/events.ts — mitt 事件总线
  ? src/store/db.ts ? persistence entry; SQLite migration pending
  ✓ src/gateway/server.ts — Hono HTTP + ws
  ✓ src/gateway/ws-handler.ts — WS 消息处理骨架
  ✓ src/gateway/static.ts — 托管 ui/dist
  ✓ src/types/ — 从现有 src/types/ 迁移 + 补充
  ✓ src/cli/index.ts — `ai-ide` 入口（status/help）
不做什么：
  ✗ 插件系统
  ✗ MCP Server
  ✗ Agent 进程管理
  ✗ 前端改造
```
### Phase 2：ACP 接入 (Week 2)
目标：能启动一个 Claude Agent，发消息能收到回复
```
做什么：
  ✓ src/acp/host.ts — ACP ClientSideConnection
  ✓ src/acp/process.ts — spawn + 管理子进程
  ✓ src/acp/adapters.ts — Claude/Codex/Mock; Gemini future 配置
  ✓ src/core/sessions.ts — Session 创建/关闭
  ✓ src/store/sessions.ts — 消息持久化
  ✓ 流式转发：ACP → events → WS → 浏览器
不做什么：
  ✗ 前端改造（还是用 mock 数据看，但 WS 已就绪）
```
### Phase 3：前端接入 (Week 3)
目标：前端从 mock 切到真实数据
```
做什么：
  ✓ ui/ 目录创建，从现有 src/ 迁移前端代码
  ✓ Zustand stores 替换 useState
  ✓ ws-client.ts 连接 Gateway
  ✓ ChatView 集成到 Workspace（修复现有问题）
  ✓ 主题统一（ChatView 暗色 → 亮色）
不做什么：
  ✗ 新功能
  ✗ Task 管理后端
```
### Phase 4：任务 + CLI + MCP (Week 4)
目标：完整的任务管理 + AI 可用的 CLI/MCP
```
做什么：
  ✓ src/core/tasks.ts — Task 状态机
  ✓ src/store/tasks.ts — Task 持久化
  ✓ src/cli/agents.ts — agents list/start/stop
  ✓ src/cli/sessions.ts — sessions list/create/close
  ✓ src/cli/tasks.ts — tasks list/create/assign
  ✓ src/cli/mcp.ts — mcp serve（MCP Server 模式）
  ✓ 前端 TaskBoard 接入真实数据
```
### Phase 5+：渐进增强
```
后面按需加：
  - Tool 注册机制（当真的需要自定义工具时）
  - Skill 系统（当 Skill 数量足够多时）
  - 插件系统（当有第三方要接入时）
  - MCP 桥接（当需要外部 MCP Server 时）
  - 自动化引擎（Cron + 事件触发）
  - 记忆/RAG（当 Agent 需要持久记忆时）
  - acp_host_py（Python 辅助工具）
```
## 八、什么时候才需要"插件系统"
```
不是一开始就需要。标准是：
当你发现自己在写第 3 个"格式完全一样的模块"时 → 抽象出插件接口
当有外部开发者要接入时 → 写 Plugin SDK
当内置模块超过 10 个且互相影响时 → 引入 ServiceRegistry
在此之前：普通 import + 目录隔离 = 足够了
```
## 九、与 07 文档的关系
07 文档（Gateway 中心 + 微内核）的**思路是对的**，但实现节奏需要调整：
| 07 的设计 | 本方案 | 何时回到 07 |
|-----------|--------|------------|
| 微内核 + ServiceRegistry | 普通模块 import | 模块超 15 个时 |
| PluginManager + 四层加载 | 不需要 | 有外部插件需求时 |
| EventBus 作唯一通道 | mitt 简单事件 + 直接调用混用 | 发现耦合问题时 |
| 10 个独立插件 | 10 个普通 TS 模块 | 需要动态加载/禁用时 |
| 完整 CLI 几十命令 | 5-6 个核心命令 | 用户反馈需要时 |
| HTTP REST API | 不做 | 有外部系统对接时 |
| OpenAI 兼容 /v1/ | 不做 | 需要模型代理时 |
| ACP Server 模式 | 不做 | 需要让 IDE 连入时 |
**07 是终态蓝图，本文档是实际施工图。**
