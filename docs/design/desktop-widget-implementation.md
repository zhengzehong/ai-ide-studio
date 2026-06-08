# 桌面悬浮部件 — 实现说明

桌面悬浮部件由 Electron 小窗口、Widget 前端页面、Widget RPC 和两张轻量状态表组成。它采用 Session-first 聚合：后端先找当前活跃或未读的 Session，再补齐 Agent、Project、Task 展示信息。

## 数据来源

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 会话列表 | `sessions` + `agents` + `projects` + `tasks` | `widget.sessions.list` 聚合为 Widget DTO |
| 会话运行态 | `sessionStore.listWithRuntimeState` | 结合 active prompt、running Agent message、running process item 和阶段兜底 |
| 会话未读 | `messages` / `session_events` + `widget_read_state` | 最新 Agent 完成消息或 `message.done` 晚于 `read_at` 即未读 |
| 任务列表 | `tasks.list` | 按项目过滤 |
| 创建任务 | `tasks.create` | 传入标题、项目和可选 Agent |
| 偏好 | `widget_preferences` | 保存固定项目和固定 Agent |

## RPC

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `widget.sessions.list` | `{ projectId?, filter?: "active" \| "all" }` | `WidgetSessionItem[]` | 默认只返回运行中或未读的 Session |
| `widget.sessions.markRead` | `{ sessionId }` | `{ ok: true }` | 校验 Session 存在后写入已读时间 |
| `widget.preferences.get` | `{ key? }` | `Record<string,string>` 或 `{ key, value }` | 读取固定项目/Agent 等偏好 |
| `widget.preferences.set` | `{ key, value }` | `{ ok: true }` | `value` 为空时删除偏好 |

旧的 `widget.agents.list` / `widget.markRead` 保留用于兼容，新的 Widget 页面不再依赖它们。

## WidgetSessionItem

```ts
interface WidgetSessionItem {
  sessionId: string
  agentId: string
  agentName: string
  agentIcon: string | null
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  sessionTitle: string | null
  status: string
  activityState: 'running' | 'idle'
  stage: string
  unread: boolean
  startedAt: string
  lastMessageAt: string | null
  completedAt: string | null
  closedAt: string | null
}
```

`activityState` 来自 Session runtime-state 聚合，不等同于 `agents.status`。`agents.status = running` 表示 runtime 在线，不能代表某个会话正在输出。

## 未读语义

`widget_read_state` 存储每个 Session 的最后已读时间：

```sql
widget_read_state (
  session_id TEXT PRIMARY KEY,
  read_at TEXT NOT NULL
)
```

后端用以下时间中的较新值作为完成时间：

1. 最新非 running Agent 消息的 `messages.timestamp`。
2. 最新 `session_events.type = "message.done"` 的 `created_at`。

当完成时间晚于 `read_at`，或没有 `read_at`，则该 Session 为未读。

## 前端状态

`ui/src/stores/widget.store.ts` 维护：

- `sessions`: 当前 Widget 会话列表。
- `preferences`: `pinnedProjectId` / `pinnedAgentId`。
- `fetchSessions(projectId, filter)`。
- `markSessionRead(sessionId)`。
- `setupListeners()`。

监听 `session:activity`、`session:done`、`session:changed`、`agent:status` 后重新拉取 `widget.sessions.list`。这让 Widget 保持轻量，不直接订阅完整聊天流。

## 任务状态映射

Widget 任务面板使用系统真实 Task 状态：

- 待办：`backlog`
- 进行中：`executing`、`needs_input`、`reviewing`、`blocked`
- 完成态：`completed`、`cancelled`

`pending` 和 `in_progress` 不是 Task 表状态，不能用于任务筛选。

## Electron 集成

Widget 窗口加载 `/widget?token=...`，主窗口加载普通应用路由。点击 Widget 会话时：

1. 前端调用 `window.electronWidget.openMain({ projectId, sessionId })`。
2. 主进程加载 `/workspace?token=...&projectId=...&sessionId=...`。
3. Workspace 根据 URL 参数选择项目和 Session。
4. Widget 调用 `widget.sessions.markRead` 标记已读。

Tray 对象保存在模块级变量中，避免被垃圾回收导致托盘图标消失。
