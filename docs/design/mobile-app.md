# AI IDE Studio 移动端设计文档

## 1. 产品定位

移动端是 AI IDE Studio 的**远程监控与轻量交互客户端**，不是桌面端的完整移植。

核心场景：
- 在手机上查看 Agent 的工作进度和对话
- 随时切换项目，浏览不同 Agent 的会话
- 轻量交互：发消息给 Agent、审批权限请求、查看任务状态
- 离开电脑后收到 Agent 完成或需要输入的通知

不做的事：
- 文件编辑器、终端
- Agent 配置和模板管理
- 规则引擎和定时任务配置
- 技能和工具的 CRUD

## 2. 技术方案

### 2.1 架构选型

采用 **Web SPA + Capacitor** 方案（与参考项目一致）：

```
ai-ide-studio/
├── src/              ← 后端 Gateway（复用 WS RPC，增加 /app/ 静态服务）
├── ui/               ← 桌面端 SPA
├── mobile/           ← 新增：移动端 SPA
│   ├── src/
│   │   ├── pages/        ← 页面组件
│   │   ├── components/   ← 移动端 UI 组件
│   │   ├── stores/       ← Zustand 状态管理
│   │   └── App.tsx
│   ├── capacitor.config.ts
│   ├── vite.config.ts
│   ├── package.json
│   └── dist/             ← 移动端构建产物
└── ui/src/           ← 当前复用 ws-client 和会话事件还原等协议辅助逻辑
```

**为什么不用 React Native / Flutter：**
- 当前项目是 React + TypeScript，Web SPA 可以复用组件逻辑和类型定义
- Capacitor 打包 APK/IPA 简单，不需要学新语言
- 参考项目验证了这条路径可行（Capacitor 8 + React 19）
- xterm.js、CodeMirror 等 Web 库在 WebView 里直接可用

### 2.2 UI 框架

移动端使用独立的 UI 组件层，复用桌面端的协议客户端和会话事件还原辅助逻辑：

| 层 | 桌面端 | 移动端 |
|----|--------|--------|
| UI 框架 | CSS Variables + 内联样式 | CSS Variables + 内联样式（移动端适配） |
| 图标 | lucide-react | lucide-react |
| 状态管理 | Zustand | Zustand（独立 store，相似结构） |
| 路由 | react-router-dom 7 | react-router-dom 7 |
| 通信 | ws-client.ts | 复用 `ui/src/services/ws-client.ts` |

### 2.3 后端复用分析

移动端直接使用现有 Gateway 的 WS RPC，并由 Gateway 在 `/app/` 下服务移动端构建产物。

| 后端能力 | 移动端是否需要 | 复用方式 |
|----------|-------------|---------|
| WS RPC 协议 | ✅ 核心 | 直接连接 ws://server:18800 或 wss://server |
| sessions.list / messages | ✅ | RPC 调用 |
| prompt / cancel | ✅ | RPC 调用 |
| subscribe / unsubscribe | ✅ | 实时消息 |
| agents.list | ✅ | RPC 调用 |
| projects.list | ✅ | RPC 调用 |
| tasks.list / tasks.get | ✅ | RPC 调用 |
| permission.respond | ✅ | RPC 调用 |
| REST /api/* | 部分 | 首页数据快速加载 |
| 认证 (LOCAL_TOKEN) | ✅ | WS URL ?token= |
| fs.list / fs.read | ❌ v1 不需要 | - |
| tools/skills/rules CRUD | ❌ | 桌面端管理 |

**后端配合点：**
- `MOBILE_STATIC_DIR` 指向移动端构建产物，默认 `./mobile/dist`
- Gateway 静态文件服务支持 `/app/*` 路径
- Electron 打包时将 `mobile/dist` 放入 `resources/app/mobile/dist`

### 2.4 共享逻辑

当前实现通过 `mobile/vite.config.ts` 的 `@desktop` alias 复用 `ui/src/services/ws-client.ts`、`ui/src/stores/session-events.ts`、`ui/src/stores/streaming-buffer.ts` 和 `ui/src/stores/turn-blocks.ts`。移动端保留独立页面和 Zustand store，以适配一次只看一个会话的手机交互。

## 3. 移动端页面设计

### 3.1 导航结构

采用**底部 Tab + 页面栈**模式（微信风格）：

```
┌─────────────────────────┐
│  顶部栏（项目名 + 切换）  │
├─────────────────────────┤
│                         │
│   当前 Tab 页面          │
│   或 Detail 页面（覆盖） │
│                         │
├─────────────────────────┤
│  会话  |  任务  |  设置   │  ← 底部 Tab
└─────────────────────────┘
```

### 3.2 页面清单

| Tab | 页面 | 功能 |
|-----|------|------|
| 会话 | `SessionListPage` | 所有会话列表（微信风格），按最后消息时间排序 |
| 任务 | `TaskListPage` | 任务列表，按状态分组 |
| 设置 | `SettingsPage` | 服务器地址、认证、主题 |

| Detail 页面 | 入口 | 功能 |
|-------------|------|------|
| `ChatPage` | 点击会话 | 对话详情，发消息，查看执行过程 |
| `TaskDetailPage` | 点击任务 | 任务详情 |

### 3.3 会话列表页（核心页面）

微信对话列表风格：

```
┌─────────────────────────────────┐
│  🔽 项目A                   🔍  │  ← 项目切换 + 搜索
├─────────────────────────────────┤
│  全部  运行中  代码Agent  测试Agent │  ← Agent 筛选 Chips
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 🤖 代码工程师        14:30  │ │  ← 会话卡片
│ │ 已修复对话流式展示问题... │ │
│ │ ● 运行中  📁 3 个文件      │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🧪 测试工程师        14:15  │ │
│ │ 单元测试已通过，覆盖率...  │ │
│ │ ✅ 空闲                    │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 📋 任务规划师        13:50  │ │
│ │ 需要你确认：是否继续...    │ │
│ │ ⚠️ 等待输入                │ │
│ └─────────────────────────────┘ │
│                                 │
│          ＋ 新建会话             │  ← FAB
└─────────────────────────────────┘
```

**筛选维度：**
1. **项目筛选** — 顶部项目切换器，切换后会话列表刷新
2. **Agent 筛选** — 横向滚动 Chips，可选「全部」或某个 Agent
3. **状态筛选** — Chip 包含「运行中」快捷过滤

**会话卡片信息：**
- Agent 头像 + 名称
- 最后消息预览（截断）
- 时间戳
- 活动状态标签（运行中 / 空闲 / 等待输入 / 已关闭）
- 未读标记（红点）

### 3.4 对话页

```
┌─────────────────────────────────┐
│  ← 代码工程师    ● 运行中  ⋮    │  ← 返回 + 状态 + 菜单
├─────────────────────────────────┤
│                                 │
│  [用户消息气泡]                  │
│                                 │
│          [Agent 消息气泡]        │
│           执行过程 · 3 项  ▶     │
│           最终回复文本...        │
│           📁 修改 2 个文件       │
│                                 │
│  [用户消息气泡]                  │
│                                 │
│          [Agent 消息气泡]        │
│           ● 正在执行...          │
│                                 │
├─────────────────────────────────┤
│  📎  输入消息...          发送 ▶ │  ← 输入栏
└─────────────────────────────────┘
```

**功能：**
- 消息列表（与桌面端一致的 Turn 模型：processBlocks + finalAnswer）
- 实时流式显示（通过 WS subscribe）
- 执行过程折叠/展开
- 文件变更卡片（复用 FileChangesCard 逻辑）
- 权限请求弹窗（permission.respond）
- 底部输入栏 + 发送按钮
- 下拉加载更多历史消息（cursor 分页）

### 3.5 任务列表页

```
┌─────────────────────────────────┐
│  任务                      🔍   │
├─────────────────────────────────┤
│  执行中 (2)                     │
│  ┌─────────────────────────────┐│
│  │ 优化 Session Store          ││
│  │ 代码工程师 · 30 分钟前       ││
│  └─────────────────────────────┘│
│  待办 (3)                       │
│  ┌─────────────────────────────┐│
│  │ 修复 WebSocket 重连          ││
│  │ 未指派 · 2 小时前            ││
│  └─────────────────────────────┘│
│  已完成 (5)                     │
│  ...                            │
└─────────────────────────────────┘
```

## 4. 数据流设计

### 4.1 WS 连接管理

```
App 启动
  → 读取服务器地址（Settings / localStorage）
  → 建立 WS 连接（ws://server:18800?token=xxx）
  → 加载项目列表 → 加载 Agent 列表 → 加载会话列表
  → 监听全局广播：session:activity, session:changed, agent:status, task:update

进入会话
  → subscribe({ sessionIds: [id] })
  → sessions.messages({ sessionId, limit: 50 })
  → 监听 session:update / session:done
  → 实时渲染流式消息

离开会话
  → unsubscribe({ sessionIds: [id] })
```

### 4.2 移动端需要的 RPC 子集

**核心（v1 必须）：**
```
subscribe / unsubscribe / prompt / session.cancel
sessions.list / sessions.create / sessions.close / sessions.rename / sessions.delete
sessions.messages / sessions.messageProcess
agents.list
projects.list
permission.respond / elicitation.respond
tasks.list / tasks.get
```

**增强（v2 可选）：**
```
sessions.archive / sessions.copy
tasks.create / tasks.update / tasks.assign
session.setModel / session.setMode
fs.list / fs.read（只读文件浏览）
```

### 4.3 离线与重连

- WS 断线后指数退避重连（1s → 2s → 4s → 最大 30s）
- 重连后自动 re-subscribe 当前查看的会话
- 重连后重新 fetchMessages 获取离线期间的消息
- Capacitor 前台服务保持 WS 长连接（Android）

## 5. 构建与部署

### 5.1 开发模式

```bash
# 启动后端
npm run dev          # Gateway :18800

# 启动移动端开发
npm run dev:mobile  # Vite :5174, 代理到 :18800
```

`mobile/vite.config.ts` 配置代理：
```typescript
server: {
  port: 5174,
  proxy: {
    '/api': 'http://localhost:18800',
    '/health': 'http://localhost:18800',
  },
}
```

### 5.2 打包 APK

```bash
cd mobile
npm run build                    # Vite 构建到 dist/
npx cap sync android             # 同步到 Android 项目
npx cap open android             # Android Studio 打开
# 或
npx cap run android              # 直接运行
```

### 5.3 后端静态服务

Gateway 通过 `MOBILE_STATIC_DIR` 服务移动端构建产物，未显式设置时默认读取 `./mobile/dist`。生产构建和 Electron 打包会生成并携带该目录，用户访问 `http://server:18800/app/` 即可在手机浏览器使用。

### 5.4 远程连接

移动端首次启动需要配置服务器地址：
- 手动输入 IP:端口
- 扫描二维码（桌面端设置页生成）
- mDNS 自动发现（v2）

## 6. 与桌面端的功能对照

| 功能 | 桌面端 | 移动端 v1 | 移动端 v2 |
|------|--------|----------|----------|
| 项目管理 | ✅ CRUD | ✅ 只读切换 | ✅ 创建 |
| Agent 管理 | ✅ CRUD + 模板 | ✅ 只读列表 | ✅ 启停 |
| 会话列表 | ✅ 侧边栏 | ✅ 全屏列表 | ✅ 搜索+归档 |
| 对话 | ✅ 完整 | ✅ 核心（发消息、看回复） | ✅ 图片附件 |
| 执行过程 | ✅ 折叠/展开 | ✅ 折叠/展开 | ✅ 懒加载详情 |
| 文件变更 | ✅ FileChangesCard | ✅ 简化版 | ✅ 完整 diff |
| 权限审批 | ✅ 弹窗 | ✅ 弹窗 | ✅ 推送通知 |
| 任务管理 | ✅ 看板 | ✅ 列表查看 | ✅ 创建+指派 |
| 文件浏览 | ✅ 树+预览 | ❌ | ✅ 只读 |
| 定时规则 | ✅ CRUD | ❌ | ❌ |
| 工具/技能 | ✅ CRUD | ❌ | ❌ |
| 模型配置 | ✅ CRUD | ❌ | ✅ 切换模型 |
| 通知推送 | ❌ | ✅ 本地通知 | ✅ FCM |

## 7. 项目结构详细设计

```
mobile/
├── android/                    ← Capacitor 生成
├── src/
│   ├── App.tsx                 ← 路由 + 主题 + WS 初始化
│   ├── pages/
│   │   ├── SessionListPage.tsx ← 会话列表（主页）
│   │   ├── ChatPage.tsx        ← 对话详情
│   │   ├── TaskListPage.tsx    ← 任务列表
│   │   ├── SettingsPage.tsx    ← 设置
│   │   └── ConnectPage.tsx     ← 首次连接配置
│   ├── components/
│   │   ├── MobileShell.tsx     ← 底部 Tab + 页面容器
│   │   ├── SessionCard.tsx     ← 会话卡片
│   │   ├── ChatBubble.tsx      ← 消息气泡
│   │   ├── ChatInput.tsx       ← 输入栏
│   │   ├── AgentFilterChips.tsx← Agent 筛选
│   │   ├── ProjectSwitcher.tsx ← 项目切换
│   │   ├── TaskCard.tsx        ← 任务卡片
│   │   └── ProcessBlock.tsx    ← 执行过程块
│   ├── stores/
│   │   ├── connection.store.ts ← WS 连接状态
│   │   ├── app.store.ts        ← 项目、Agent、全局状态
│   │   └── chat.store.ts       ← 当前会话消息 + 流式状态
│   ├── services/
│   │   ├── ws-client.ts        ← WebSocket 客户端（复用/适配）
│   │   └── capacitor.ts        ← 原生能力封装
│   └── index.css               ← 移动端全局样式
├── index.html
├── vite.config.ts
├── tsconfig.json
├── capacitor.config.ts
└── package.json
```

## 8. 实施计划

### 已覆盖能力

- mobile workspace + Vite + Capacitor 配置
- WS 客户端连接（复用桌面端 ws-client）
- 会话列表页（项目切换 + Agent 筛选）
- 对话页（消息列表 + 发送 + 流式接收）
- 任务列表页
- 执行过程、文件变更、权限请求和输入请求卡片
- 设置页（服务器地址配置）

### 后续原生能力

- Capacitor Android 工程生成和 APK 构建
- 前台服务保持 WS 连接
- 本地推送通知
- 扫码连接
