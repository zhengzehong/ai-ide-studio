# 桌面悬浮部件（Desktop Widget）设计文档

## 1. 功能概述

在 Electron 桌面应用模式下，提供一个**常驻桌面的迷你悬浮窗**，让用户无需切换到主窗口即可：
- 查看正在执行的 Agent 及其状态
- 快速记录和管理待办事项

## 2. 设计原则

- **简约**：像桌面便签一样干净，没有多余的视觉噪音
- **单色调**：黑白灰为主，不堆砌彩色元素
- **信息密度**：每条只显示关键信息（名称 + 描述 + 时间）
- **Tab 切换**：Agent 和待办共用一个窗口，通过 Tab 签切换

## 3. 界面结构

```
┌──────────────────────────────┐
│ ● [ai-ide-studio ▾] 📌  − ✕ │  ← 状态点 + 项目选择(可固定) + 按钮
├──────────────────────────────┤
│ Agent [3]     任务 [4]       │  ← Tab 签切换
├──────────────────────────────┤
│                              │
│ 🤖● frontend-dev  ide 2:15  │  ← 绿点闪烁 + 名称 + 项目缩写 + 时间
│    正在编辑 Settings.tsx     │  ← 描述行
│                              │
│ 🤖◉ backend-api   ide 0:45  │  ← 橙点闪烁 = 需操作
│    ⚠ 等待权限确认           │
│                              │
│ 🤖● doc-writer    ide 1:02  │  ← 运行中
│    生成 API 文档...          │
│                              │
│ 🤖◉ test-runner   ide 3m前  │  ← 蓝点 = 已完成未读
│    ● 已完成 · 未读           │
│                              │
│ (↕ 滚动更多)                 │
└──────────────────────────────┘
```

任务面板：

```
├──────────────────────────────┤
│ Agent [3]     任务 [4]       │
├──────────────────────────────┤
│ [待处理] [进行中] [全部]     │  ← 状态筛选
│                              │
│ ○ 优化登录页性能             │
│   → frontend-dev             │  ← 分派的 Agent
│ ○ 修复移动端侧边栏          │
│ ○ 补充单元测试               │
│   → test-runner              │
│ ○ 撰写部署文档               │
│   → doc-writer               │
│                              │
│ (↕ 滚动更多)                 │
├──────────────────────────────┤
│ [新建任务...] [🤖 front•] [+]│  ← 快速创建 + 固定Agent
└──────────────────────────────┘
```

## 4. 视觉规范

| 元素 | 规格 |
|------|------|
| 窗口尺寸 | 300×360 固定（高度固定，内容超出滚动） |
| 圆角 | 14px |
| 背景 | 半透明白 `rgba(255,255,255,0.82)` + `backdrop-filter: blur(20px)` |
| 边框 | `1px solid rgba(255,255,255,0.45)` |
| 阴影 | `0 8px 40px rgba(0,0,0,0.12)` |
| 字号 | 标题 12px，描述 11px，时间 10px |
| 色调 | 灰白半透明为主，极简 |
| 执行中指示 | 绿色小圆点 + 呼吸脉冲动画 |
| 需操作提示 | 橙色小圆点 + 闪烁动画 + 橙色描述文字 |
| 已完成 | opacity 0.4 |
| Tab 激活 | 下划线 + 加粗 |
| 滚动条 | 4px 宽，半透明，hover 加深 |
| 收起态 | 44×44 圆角方块 + 绿色角标 |

## 5. Agent 条目显示规则

每个 Agent 条目显示：
- **图标**：🤖 统一使用
- **状态指示**：图标右上角小圆点
  - 执行中：绿色圆点 + 呼吸脉冲动画
  - 需操作：橙色圆点 + 闪烁动画
  - 已完成未读：蓝色静态圆点
  - 已完成已读：无圆点，整行 opacity 0.4
- **会话名称**：Agent 实例名
- **项目名**：小灰字缩写（如 "ide-studio"）
- **时间**：运行中显示已用时（m:ss），已完成显示结束时间距今
- **描述行**：一行文字
  - 正常运行：当前步骤（如"正在编辑 xxx"）
  - 需要操作：橙色 "⚠ 等待权限确认"
  - 未读完成：蓝色 "● 已完成 · 未读"
  - 已读完成：灰色 "已完成 · 摘要"

**默认筛选：**
- 只显示「运行中」+「需操作」+「未读已完成」
- 已读已完成的保留最近 3 条，低透明度显示

**项目筛选：**
- 顶栏有项目选择下拉（全部 / 具体项目）
- 选择后可**固定**（📌），下次启动自动选中，不用每次选

## 6. 任务面板

### 数据来源

直接复用现有 Task 系统（`tasks` 表），不新建待办表。

### 筛选

- 子筛选按钮：「待处理」/「进行中」/「全部」
- 默认"待处理"（status = pending）
- 自动按固定的项目过滤

### 条目显示

- 状态圆圈：○ pending / ◔ in_progress / ● completed
- 任务标题
- 分派 Agent 名称（如有，显示 "→ frontend-dev"）

### 快速创建任务

底部创建栏：`[输入框] [Agent选择] [+按钮]`

- 输入框回车或点 [+]：创建任务
- Agent 选择下拉：当前项目的可用 Agent，选中后任务自动分派
- Agent 选择**可固定**（带蓝色 • 标记），固定后每次创建自动使用
- 调用 `tasks.create` RPC，传入 `title` + `assignAgentId` + `projectId`

## 7. 技术实现

### 7.1 Electron 窗口

```typescript
function createWidgetWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 300,
    height: 380,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: join(electronDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
}
```

### 7.2 前端路由

```
/widget → WidgetPage（独立布局，无侧边栏）
```

### 7.3 数据通信

- Agent 状态：WS 订阅 `agent:status` / `session:activity` / `session:done`
- 任务列表：复用 `tasks.list` RPC + WS 订阅 `task:update` / `task:created`
- 创建任务：复用 `tasks.create` RPC（已支持 `assignAgentId` + `projectId`）
- 已读标记：新增 `widget.markRead` RPC
- 偏好固定：新增 `widget.preferences.get/set` RPC

### 7.4 IPC（最小化）

| Channel | 用途 |
|---------|------|
| `widget:toggle-pin` | 切换置顶 |
| `widget:minimize` | 收起为图标态 |
| `widget:open-main` | 激活主窗口 |

## 8. 两种形态

| 形态 | 尺寸 | 触发 |
|------|------|------|
| 展开态 | 300×380 固定高度（内容滚动） | 点击收起态图标 |
| 收起态 | 44×44 | 点击顶栏收起按钮 |

收起态只显示一个 ⚡ 图标 + 右上角运行中 Agent 数量角标（绿色）。

## 9. 实施计划

### Phase 1：骨架
- [ ] Tray 系统托盘
- [ ] Widget BrowserWindow 创建
- [ ] `/widget` 路由 + WidgetPage
- [ ] Preload IPC bridge

### Phase 2：Agent 面板
- [ ] `widget.agents.list` RPC + 项目筛选
- [ ] 运行中/未读 Agent 列表 + 绿点动画
- [ ] 已读标记 + 点击跳转主窗口

### Phase 3：任务面板
- [ ] 复用 `tasks.list` + 状态筛选
- [ ] 快速创建 + Agent 分派
- [ ] 项目/Agent 固定偏好（`widget_preferences`）

### Phase 4：体验
- [ ] 位置记忆
- [ ] 收起态角标
- [ ] 深色模式
