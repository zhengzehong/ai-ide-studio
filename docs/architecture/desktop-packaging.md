# 桌面打包与 Web 兼容架构

> 本文档描述 AI IDE Studio 同时支持 Web 部署和 Electron 桌面打包时的目标架构边界。它不是实施计划；具体改动应拆到 `docs/superpowers/plans/`。

## 目标

AI IDE Studio 需要支持两种运行模式，并且两种模式共享同一套后端、前端和数据模型：

1. **Web 模式**：后端作为标准 HTTP/WS 服务运行，前端通过浏览器访问。
2. **Electron 模式**：桌面应用负责启动后端服务并打开窗口；同一后端仍可被本机浏览器访问。

核心原则是：**Electron 只是启动器和窗口壳，不承载业务逻辑。** 业务能力仍在 Hono/WS 后端、SQLite store、ACP Host、MCP 工具平台和 React SPA 中。

## 总体拓扑

```text
Web 模式
  node dist/entry.js 或 npm run dev
      │
      ▼
  Backend Server 127.0.0.1:18800
      ├── HTTP API / MCP
      ├── WebSocket RPC
      └── 生产模式托管 ui/dist
              ▲
              │ HTTP / WS
  浏览器 ──────┘

Electron 模式
  ai-ide-studio.exe
      │
      ▼
  Electron Main Process
      ├── 选择可用本地端口
      ├── 设置 DATA_DIR / AI_IDE_RUNTIME / 本地访问 token
      ├── 启动 Backend Server 子进程
      ├── 等待 /health 就绪
      └── BrowserWindow 加载 http://127.0.0.1:<port>
              │
              ▼
  Backend Server 127.0.0.1:<port>
      ├── HTTP API / MCP
      ├── WebSocket RPC
      └── 托管 ui/dist
              ▲
              │ 同一个本地服务
  Electron 窗口 / 本机浏览器 ──────┘
```

## 分层边界

```text
Electron Shell（可选）
  electron/main.ts
    - 管理桌面生命周期
    - 选择端口
    - 启动/停止后端进程
    - 创建窗口、托盘、浏览器打开入口
  electron/preload.ts
    - 默认保持最小
    - 只在需要原生能力时暴露 feature-detection bridge

Backend App（共享）
  src/app.ts
    - 初始化配置、SQLite、seed、Gateway、Rule Engine
    - 暴露 startApp()/stop() 生命周期
  src/entry.ts
    - Web/CLI 启动入口
    - 只负责读取配置并调用 startApp()
  src/gateway/server.ts
    - Hono HTTP、WS 升级、MCP 挂载
  src/gateway/static-assets.ts
    - 生产模式托管 ui/dist
    - SPA fallback

Frontend SPA（共享）
  ui/src
    - React + Zustand + WS Client
    - 默认从 window.location 推导 HTTP/WS 地址
    - 不依赖 Electron renderer API
```

## 关键设计决策

### 1. 后端保持标准 HTTP/WS 服务

后端不依赖 Electron API，也不通过 Electron IPC 对外提供业务能力。所有 UI、CLI、浏览器和桌面窗口都通过同一套 HTTP/WS 协议访问后端。

这样可以保证：

- Web 部署和桌面版不会出现两套业务路径。
- WS RPC、MCP、ACP 会话、SQLite 持久化都保持一致。
- Electron 问题可以隔离在启动、端口、打包和窗口管理层。

### 2. 后端需要显式应用生命周期

桌面模式不能直接 import 当前的 `src/entry.ts` 并依赖模块副作用启动服务。目标边界是：

```text
src/app.ts
  startApp(config) -> { server, wss, stop() }

src/entry.ts
  loadConfig()
  startApp(config)
  注册 SIGINT/SIGTERM
```

Electron main process 可以选择 fork `dist/entry.js`，也可以在未来 in-process 调用 `startApp()`。第一版推荐 **fork 独立后端进程**，因为它更容易隔离崩溃、日志、退出和重启。

打包后的 `process.execPath` 是应用自身 exe，不是普通 `node.exe`。不能用它直接执行后端入口，否则会递归启动新的 Electron 应用实例，导致进程暴涨和系统卡顿。桌面版后端子进程应优先使用随包携带的普通 Node 可执行文件（`resources/node/node.exe`），开发环境可用 `AI_IDE_NODE_CMD` 或系统 `node.exe` 兜底。这样后端继续运行在 Node ABI 下，避免 `better-sqlite3` 同时面对 Electron ABI 和 Node ABI 的冲突。

### 3. 生产模式由后端托管前端静态资源

生产构建后，后端负责托管 `ui/dist/`：

```text
/api/*     -> HTTP API
/mcp       -> HTTP MCP
/ws        -> WebSocket 升级所在服务端口
/assets/*  -> ui/dist/assets
/*         -> ui/dist/index.html（SPA fallback）
```

收益：

- Web 版只需要启动一个后端进程。
- Electron 窗口加载 `http://127.0.0.1:<port>`，避免 `file://` 路由和资源路径问题。
- 本机浏览器可以访问同一个后端服务，便于调试和多窗口使用。

### 4. 前端不硬编码 localhost 端口

前端默认从当前页面地址推导 WS 地址：

```text
http://127.0.0.1:18800       -> ws://127.0.0.1:18800
https://example.com          -> wss://example.com
http://127.0.0.1:<随机端口>  -> ws://127.0.0.1:<随机端口>
```

开发模式可以通过环境变量覆盖，例如 `VITE_WS_URL`。不应在生产代码中固定连接 `ws://localhost:18800`，否则远程 Web 部署、Electron 随机端口和反向代理场景都会出错。

### 5. Electron 使用本地端口，不替换通信协议

Electron 窗口仍然访问 HTTP/WS，不改用 IPC。Electron main process 只需要知道后端实际端口，并把窗口加载到对应 URL。

端口策略：

| 模式 | 策略 |
|------|------|
| Web 模式 | 默认使用 `PORT` 或 `18800`，端口冲突直接启动失败 |
| Electron 模式 | 优先尝试 `18800`，被占用时选择空闲本地端口 |
| 多开应用 | 默认复用或拒绝多开；如果允许多开，必须使用不同端口和数据目录策略 |

后端应绑定 `127.0.0.1`，不要在桌面模式默认监听 `0.0.0.0`。

### 6. 本地访问需要最小安全边界

桌面版会在本机开放 HTTP/WS 服务。为了避免其他本机网页误用文件、项目、MCP 或 Agent 能力，Electron 模式需要本地访问 token：

```text
Electron Main Process
  生成一次性 token
  启动后端时传入 AI_IDE_LOCAL_TOKEN
  加载前端时通过启动 URL 或安全注入方式传给 SPA

Backend Server
  Electron 模式下校验 HTTP/WS 请求 token
  只接受 127.0.0.1 / localhost 来源
```

Web 开发模式可以不启用 token；生产 Web 部署如果需要公网访问，应另行设计认证，不复用桌面本地 token 机制。

### 7. 数据目录由运行模式决定

SQLite、日志和用户配置不能依赖不稳定的当前工作目录。

| 模式 | 数据目录策略 |
|------|--------------|
| Web 模式 | `DATA_DIR`，默认 `./data` |
| Electron 安装版 | Electron `app.getPath('userData')/data` |
| Electron 便携版 | exe 同级 `data/`，由 `AI_IDE_PORTABLE=1` 控制 |

后端只读取 `DATA_DIR`，不直接 import Electron API。Electron main process 负责把正确路径写入环境变量。

### 8. ACP runtime 路径需要打包感知

开发环境可以从 `node_modules/.bin` 找到 ACP runtime，但打包后路径不同。runtime resolver 的目标优先级：

```text
1. 环境变量覆盖
   - AI_IDE_CLAUDE_ACP_CMD
   - AI_IDE_CODEX_ACP_CMD
2. Electron resources 目录中的 runtime 可执行文件
3. 项目 node_modules/.bin（开发模式）
4. npx fallback（仅开发/诊断兜底，不作为桌面版主路径）
```

注意：桌面版不能依赖用户机器已全局安装 `npx`、`claude-agent-acp` 或 `codex-acp`。如果某个 runtime 依赖外部 CLI，例如 Codex/Claude 本体，也需要在设置页明确展示依赖状态和修复指引。

### 9. native module 保持 Node ABI

`better-sqlite3` 是原生模块。当前桌面版后端由普通 Node 子进程运行，不由 Electron 主进程加载，所以 native module 应保持 Node ABI：

- 打包时携带当前 Node 可执行文件到 `resources/node/node.exe`。
- 后端入口放到 `resources/app/electron/backend-main.js`，由 `resources/node/node.exe` 启动。
- 后端依赖从打包后的 `resources/app/node_modules` 解析，`.node` 文件通过 `asarUnpack` 留在可加载位置。
- PC 前端静态资源放到 `resources/app/ui/dist`，移动端 Web App 静态资源放到 `resources/app/mobile/dist`。
- 不在 Electron 主进程或 renderer 中 import `better-sqlite3`。
- 在启动前验证 SQLite 能打开用户数据目录下的数据库。

如果 native module 加载失败，应用应在启动页显示明确错误，而不是空白窗口。

## 配置约定

| 变量 | 说明 |
|------|------|
| `PORT` | 后端监听端口；Electron 模式由 main process 注入实际端口 |
| `HOST` | 后端监听地址；Electron 模式应为 `127.0.0.1` |
| `DATA_DIR` | SQLite、日志、用户配置目录 |
| `AI_IDE_RUNTIME` | `web` / `electron`，用于路径、安全和诊断分支 |
| `AI_IDE_PORTABLE` | `1` 表示便携模式，数据目录跟随 exe |
| `AI_IDE_LOCAL_TOKEN` | Electron 本地访问 token |
| `AI_IDE_CLAUDE_ACP_CMD` | Claude ACP runtime 命令覆盖 |
| `AI_IDE_CODEX_ACP_CMD` | Codex ACP runtime 命令覆盖 |

## 目录结构目标

```text
src/
├── app.ts                    # 共享后端生命周期入口
├── entry.ts                  # Web/CLI 启动入口
└── gateway/
    ├── server.ts             # HTTP/WS/MCP 组合
    └── static-assets.ts      # ui/dist 静态资源和 SPA fallback

electron/
├── main.ts                   # Electron 主进程
├── preload.ts                # 最小 preload bridge
└── builder.config.ts         # 打包配置（或使用 yml）

根目录
├── electron-builder.yml      # electron-builder 配置
└── scripts/
    └── build-electron.ts     # 构建编排脚本
```

## 构建产物边界

### Web 构建

```text
npm run build
  -> tsc 编译后端到 dist/
  -> vite build 前端到 ui/dist/
  -> node dist/entry.js 可启动完整 Web 版
```

### Electron 构建

```text
npm run build:electron
  -> npm run build
  -> 编译 electron/main.ts、preload.ts 和 backend-main.ts 到 electron/dist/
  -> electron-builder 打包 dist/、ui/dist/、node_modules、普通 Node 可执行文件、native module、ACP runtime
  -> 输出安装包和便携包
```

Windows 输出约定：

```text
release/AI IDE Studio Setup <version>.exe  # NSIS 安装包，给普通用户安装使用
release/AI IDE Studio <version>.exe        # portable 便携单 exe，给免安装分发使用
release/win-unpacked/                      # 构建中间展开目录，不作为“免安装包”分发
```

`win-unpacked/` 包含 Electron/Chromium 运行时 DLL、pak、locale、resources 和 native module，是 electron-builder 的展开产物。它可以用于开发者本机排查，但不是面向用户的绿色包；如果需要“免安装一个文件”，使用 portable target 输出的单 exe。

Electron 产物必须包含：

- 后端编译产物 `dist/`
- 前端静态产物 `ui/dist/`
- 移动端静态产物 `mobile/dist/`
- Electron 主进程产物 `electron/dist/`
- Node 后端入口 `resources/app/electron/backend-main.js`
- 普通 Node 可执行文件 `resources/node/node.exe`
- 运行所需依赖和 native module
- ACP runtime 可执行文件或明确的外部依赖检测逻辑

## 窗口与进程生命周期

Electron main process 负责：

- 启动时显示加载状态。
- 等 `/health` 成功后加载主页面。
- 后端启动失败时显示错误页和日志位置。
- 主窗口关闭时根据配置选择退出或最小化到托盘。
- 退出应用时停止后端进程。
- 后端异常退出时提示用户，并避免留下僵尸进程。

业务状态不存放在 Electron main process。窗口重开、浏览器访问、刷新页面都应通过后端 SQLite 和 WS 事件恢复状态。

## 与现有架构的关系

| 现有组件 | 目标影响 |
|----------|----------|
| `src/entry.ts` | 变薄，只保留 Web/CLI 启动职责 |
| `src/app.ts` | 新增，共享后端生命周期边界 |
| `src/gateway/server.ts` | 保持 HTTP/WS/MCP 组合职责，静态资源逻辑下沉到 helper |
| `src/acp/runtime-registry.ts` | 增加 Electron resources 路径解析，保留现有环境变量覆盖 |
| `src/core/config.ts` | 增加 HOST、运行模式、本地 token、数据目录策略和 PC/移动端静态资源目录读取 |
| `ui/src/stores/connection.store.ts` | 从页面地址推导 WS URL，保留开发覆盖能力 |
| SQLite store/migrations | 不因 Electron 改变，仍由现有 migrator 管理 |
| WS RPC / MCP / ACP | 不因 Electron 改变协议，只复用同一后端服务 |

## 不做的事情

- 不在 Electron renderer 中运行后端业务逻辑。
- 不用 Electron IPC 替代现有 HTTP/WS 协议。
- 不为 Electron 维护一套独立前端。
- 不把 SQLite 换成 IndexedDB 或浏览器本地存储。
- 不让后端直接依赖 Electron API。
- 第一版不做自动更新；后续可单独设计 electron-updater。

## 实施含义

这套架构落地前，代码需要具备几个基础能力：

- 后端有可复用的 `startApp()` / `stop()` 生命周期。
- 生产后端可以托管 `ui/dist` 并处理 SPA fallback。
- 前端连接地址不硬编码 `localhost:18800`。
- 配置层能区分 Web/Electron 的端口、HOST、DATA_DIR 和本地 token。
- ACP runtime resolver 能识别 Electron resources 路径。
- 打包配置能正确处理 `better-sqlite3` native module。

这些能力应分批实现，每批都保持 Web 模式可用并通过现有测试。
