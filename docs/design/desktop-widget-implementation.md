# 桌面悬浮部件 — 实现方案

## 概述

桌面悬浮部件是 Electron 窗口中的常驻迷你面板，展示运行中/未读 Agent 和任务列表，支持快速创建任务并分派 Agent。

**核心改动点：**
- 待办 = 复用现有 Task 系统（不新建表）
- Agent 列表按项目筛选，默认只显示运行中 + 未读
- 快速创建任务时可选 Agent 直接分派，并固定常用项目/Agent

---

## 1. 数据来源分析

### 1.1 任务（Task）— 已有

直接复用 `tasks` 表和 `tasks.list` / `tasks.create` RPC：

| 字段 | 说明 |
|------|------|
| `title` | 待办标题 |
| `status` | `pending` / `in_progress` / `completed` / `cancelled` |
| `assigned_agent_id` | 分派的 Agent |
| `project_id` | 所属项目 |
| `created_at` | 创建时间 |

Widget 中"待办"面板就是 Task 列表的筛选视图。

### 1.2 Agent 状态 — 已有

通过 WS 事件实时聚合（`session:activity`、`agent:status`、`session:done`）。

**新增需求：每条 Agent 要显示所属项目名。**

### 1.3 "未读"概念 — 新增

Agent 完成任务后，如果用户没有查看结果，标记为"未读"。需要一个轻量的已读状态追踪。

---

## 2. 后端改动

### 2.1 新增 Migration：widget 配置 + 已读状态

文件：`src/store/migrations/011-widget-state.ts`

```sql
-- 用户对 session 完成事件的已读状态
CREATE TABLE IF NOT EXISTS widget_read_state (
  session_id TEXT PRIMARY KEY,
  read_at TEXT NOT NULL
);

-- 部件用户偏好（固定项目/Agent 等）
CREATE TABLE IF NOT EXISTS widget_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.2 新增 Store：`src/store/widget-state.ts`

```typescript
export const widgetStateStore = {
  // 已读状态
  markRead(sessionId: string): void
  isRead(sessionId: string): boolean
  listUnread(sessionIds: string[]): string[]  // 返回未读的 sessionId 列表
  
  // 偏好设置（固定项目、固定 Agent 等）
  getPreference(key: string): string | undefined
  setPreference(key: string, value: string): void
}
```

### 2.3 新增/扩展 RPC

文件：`src/gateway/rpc/widget.ts`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `widget.agents.list` | `projectId?, filter?` | `WidgetAgentData[]` | 聚合运行中 Agent + 未读完成的 |
| `widget.markRead` | `sessionId` | `{ ok: true }` | 标记为已读 |
| `widget.preferences.get` | `key` | `string \| null` | 读取偏好 |
| `widget.preferences.set` | `key, value` | `{ ok: true }` | 保存偏好 |

**任务相关 RPC 无需改动**，直接复用现有 `tasks.list`、`tasks.create`、`tasks.update`。

### 2.4 `widget.agents.list` 实现逻辑

```typescript
async function handleAgentsList(msg, { sendResult }) {
  const projectId = msg.projectId as string | undefined
  const filter = (msg.filter as string) || 'active'  // 'active' | 'all'
  
  // 从 agentStore 拿所有 Agent
  const agents = agentStore.list(projectId)
  
  // 从 sessionStore 拿每个 Agent 最新活动 session
  const result = agents.map(agent => {
    const session = sessionStore.getLatestForAgent(agent.id)
    const isRunning = agent.status === 'running'
    const isUnread = session?.status === 'completed' 
      && !widgetStateStore.isRead(session.id)
    
    return {
      agentId: agent.id,
      agentName: agent.name,
      projectId: agent.project_id,
      projectName: getProjectName(agent.project_id),
      sessionId: session?.id,
      status: agent.status,      // running | idle | standby
      stage: session?.stage,
      isUnread,
      startedAt: session?.started_at,
    }
  })
  
  // 筛选：只保留运行中 + 未读
  if (filter === 'active') {
    return sendResult(result.filter(a => 
      a.status === 'running' || a.isUnread
    ))
  }
  sendResult(result)
}
```

### 2.5 WS 事件补充

不需要新增事件类型。Widget 前端直接订阅已有的：
- `agent:status` — Agent 状态变化
- `session:done` — 会话完成（用于显示未读）
- `task:update` / `task:created` — 任务变更

---

## 3. Electron 层改动

与之前方案一致，不需要额外改动：

| 文件 | 改动 |
|------|------|
| `electron/widget-window.ts` | 新增，创建 300×360 无边框窗口 |
| `electron/preload.ts` | 暴露 `togglePin` / `minimize` / `openMain` IPC |
| `electron/main.ts` | 创建 widget + Tray + IPC handlers |

---

## 4. 前端 Widget 页面设计

### 4.1 页面结构

```
WidgetPage
├── WidgetHeader         (标题 + 项目选择器 + 置顶/收起)
├── WidgetTabs           (Agent | 任务 切换)
├── AgentPanel
│   ├── AgentFilterBar   (项目筛选下拉，固定后不再每次选)
│   └── AgentList        (滚动列表)
│       └── AgentRow × N (图标 + 绿点/橙点 + 名称 + 项目 + 描述 + 时间)
└── TaskPanel
    ├── TaskFilterBar    (状态筛选：待处理 / 进行中 / 全部)
    ├── TaskList         (滚动列表)
    │   └── TaskRow × N  (复选框 + 标题 + 状态标签)
    └── QuickCreateBar   (输入框 + Agent 选择 + 创建按钮)
```

### 4.2 Agent 面板

**显示字段：**
- 🤖 图标 + 状态点（绿色闪烁=运行中，橙色=需操作，蓝点=未读已完成）
- Agent 名称
- 项目名（小灰字，如 "ai-ide-studio"）
- 描述行：当前阶段 / "⚠ 等待确认" / "已完成 · 未读"
- 右侧时间

**筛选逻辑：**
- 默认：只显示「运行中」+「未读已完成」
- 项目筛选：顶部下拉，可选"全部项目"或某个具体项目
- 项目选择**可固定**（存入 widget_preferences），固定后每次打开自动选中

**已读机制：**
- 用户在 widget 中点击某个已完成 Agent → 标记已读 + 跳转主窗口对应会话
- 在主窗口中打开对应会话 → 也自动标记已读

### 4.3 任务面板

**显示字段：**
- 状态指示（○ pending / ◔ in_progress / ● completed）
- 任务标题
- 分派的 Agent 名称（如有）
- 创建时间

**筛选逻辑：**
- Tab 子筛选：「待处理」/「进行中」/「全部」，默认"待处理"
- 按当前固定的项目筛选（与 Agent 面板共用同一项目选择）

**快速创建任务：**

```
┌──────────────────────────────────┐
│ [输入任务标题...]   [Agent▾] [+] │
└──────────────────────────────────┘
```

- 输入框：任务标题
- Agent 下拉：当前项目的可用 Agent 列表，选中后任务自动分派
- Agent 选择**可固定**：固定后不用每次选，下次创建自动使用
- 点 [+] 或回车：创建任务（调用 `tasks.create`，带 `assignAgentId` 和 `projectId`）

### 4.4 项目固定机制

Widget 的全局状态中有一个"当前固定项目"：

```typescript
interface WidgetPreferences {
  pinnedProjectId: string | null    // 固定项目，null 表示全部
  pinnedAgentId: string | null      // 固定 Agent（创建任务用）
}
```

- 存入后端 `widget_preferences` 表，关闭重启后恢复
- 顶栏的项目选择器：选择后自动保存为固定
- Agent/任务面板根据固定项目自动过滤

---

## 5. Store 设计

### 5.1 `ui/src/stores/widget.store.ts`

```typescript
interface WidgetStore {
  // ── 偏好 ──
  pinnedProjectId: string | null
  pinnedAgentId: string | null
  loadPreferences: () => Promise<void>
  setPinnedProject: (projectId: string | null) => Promise<void>
  setPinnedAgent: (agentId: string | null) => Promise<void>

  // ── Agent 列表 ──
  agents: WidgetAgentItem[]
  fetchAgents: () => Promise<void>
  markRead: (sessionId: string) => Promise<void>

  // ── 任务列表（复用 Task 系统）──
  tasks: TaskData[]
  taskFilter: 'pending' | 'in_progress' | 'all'
  setTaskFilter: (f: 'pending' | 'in_progress' | 'all') => void
  fetchTasks: () => Promise<void>
  quickCreateTask: (title: string) => Promise<void>

  // ── WS 实时更新 ──
  setupListeners: () => () => void
}
```

### 5.2 Agent 状态聚合（WS 驱动）

```typescript
setupListeners: () => {
  const offs = [
    wsClient.on('agent:status', (msg) => { /* 更新 agents 列表 */ }),
    wsClient.on('session:done', (msg) => { /* 新增未读条目 */ }),
    wsClient.on('session:activity', (msg) => { /* 更新 stage */ }),
    wsClient.on('task:update', () => { get().fetchTasks() }),
    wsClient.on('task:created', () => { get().fetchTasks() }),
  ]
  return () => offs.forEach(off => off())
}
```

---

## 6. 不需要新增数据库表的部分

| 需求 | 实现方式 |
|------|----------|
| 待办/任务列表 | 复用 `tasks` 表 + `tasks.list` RPC |
| 创建任务 | 复用 `tasks.create` RPC（已支持 `assignAgentId`、`projectId`） |
| Agent 运行状态 | WS 事件实时聚合 + `widget.agents.list` RPC |
| 项目列表 | 复用 `projects.list` RPC |
| Agent 列表 | 复用已有 `agentStore` |

**只新增：** `widget_read_state`（已读追踪）+ `widget_preferences`（偏好存储）

---

## 7. 文件改动清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 新增 | `src/store/migrations/011-widget-state.ts` | 已读状态 + 偏好表 |
| 新增 | `src/store/widget-state.ts` | 已读/偏好 Store |
| 新增 | `src/gateway/rpc/widget.ts` | widget RPC handlers |
| 修改 | `src/gateway/rpc/registry.ts` | 注册 widget handlers |
| 修改 | `src/store/migrations/index.ts` | 注册 011 |
| 新增 | `electron/widget-window.ts` | Widget 窗口创建与管理 |
| 修改 | `electron/preload.ts` | 暴露 IPC bridge |
| 修改 | `electron/main.ts` | Widget + Tray 集成 |
| 新增 | `ui/src/pages/Widget.tsx` | Widget 独立页面 |
| 新增 | `ui/src/stores/widget.store.ts` | Widget zustand store |
| 修改 | `ui/src/App.tsx` | 添加 /widget 路由 |

---

## 8. 实施顺序

```
Phase 1 — 后端（半天）
  ├── 011-widget-state migration
  ├── widget-state store（已读 + 偏好）
  ├── widget RPC（agents.list, markRead, preferences）
  └── 验证：搭配现有 tasks RPC 联调

Phase 2 — Electron（半天）
  ├── widget-window.ts
  ├── preload IPC
  ├── main.ts 集成
  └── Tray 基础功能

Phase 3 — 前端 Widget（1 天）
  ├── Widget.tsx 页面框架
  ├── widget.store.ts
  ├── Agent 面板 + 项目筛选 + 绿点动画
  ├── 任务面板 + 状态筛选
  └── 快速创建 + Agent 分派

Phase 4 — 体验打磨
  ├── 偏好固定（项目/Agent 记忆）
  ├── 已读 ↔ 未读联动（widget + 主窗口双向）
  ├── 位置记忆
  └── 收起态角标
```

---

## 9. 原型对应关系

| 原型元素 | 实际数据来源 |
|----------|-------------|
| Agent 条目 | `widget.agents.list` RPC + WS 实时推送 |
| 绿色闪烁点 | `agent.status === 'running'` |
| 橙色闪烁点 | session 有未处理的 permission/elicitation |
| 蓝色静态点 | `session.status === 'completed' && !isRead` |
| 项目名灰字 | Agent 关联的 project.name |
| 任务列表 | `tasks.list` RPC，按 projectId + status 筛选 |
| 快速创建 | `tasks.create` RPC，带 title + assignAgentId + projectId |
| 固定项目/Agent | `widget.preferences.set` / `get` |
