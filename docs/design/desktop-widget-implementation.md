# 桌面悬浮部件 — 实现说明

桌面悬浮部件由 Electron 透明窗口、Widget React 页面和 Agent activity read model 组成。正式页面采用 Agent-first 聚合：后端从 Session 运行态、已读状态和直接 Task 关联中选出每个 Agent 的代表会话，前端只负责筛选与两行展示。

## 数据来源

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| Agent 动态 | `sessions` + `agents` + `projects` + `tasks` | `widget.agentActivity.list` 聚合为一 Agent 一条的 DTO |
| Session 运行态 | `sessionStore.listWithRuntimeState` | 结合 active prompt、running Agent message 和 running process item |
| Session 未读 | `sessions.last_message_at` / `sessions.last_read_at` | 与 PC 和 mobile 使用同一已读时间戳 |
| 关联任务 | `sessions.task_id` → `tasks` | 只显示明确的直接关联，不按 assigned Agent 猜测 |
| 项目偏好 | `widget_preferences` | 保存固定项目 |

## RPC

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `widget.agentActivity.list` | `{ projectId? }` | `WidgetAgentActivityItem[]` | 每个 Agent 一个代表会话，按 activityAt 倒序，最多 20 个 |
| `widget.sessions.markRead` | `{ sessionId }` | `{ ok: true }` | 主窗口成功导航后更新共享 Session 已读时间 |
| `widget.preferences.get` | `{ key? }` | 偏好对象 | 读取固定项目等偏好 |
| `widget.preferences.set` | `{ key, value }` | `{ ok: true }` | 保存或删除偏好 |

旧的 `widget.sessions.list`、`widget.agents.list` 和 `widget.markRead` 继续保留兼容，正式 Widget 页面不依赖它们。

## 代表会话

同一 Agent 的候选 Session 按以下优先级选择：

1. `activityState = running`。
2. 直接关联 Task 的状态为 `needs_input` 或 `blocked`。
3. Session 有未读结果。
4. 普通最近活跃 Session。

同一优先级内按 `last_message_at`、完成时间、`updated_at`、`started_at` 的可用时间选择较新项。最终结果按代表会话 `activityAt` 倒序排列。

## WidgetAgentActivityItem

DTO 包含以下信息域：

- Agent：ID、名称、图标。
- Project：ID、名称。
- 代表 Session：ID、标题、阶段、运行态、未读、活跃时间。
- 直接 Task：ID、标题、状态。
- 聚合信息：该 Agent 的未读 Session 数。

`activityState` 只允许 `running`、`needs_input` 和 `idle`。其中 `running` 来自 Session 运行证据，不能由 `agents.status` 推断。

## 前端状态

`ui/src/stores/widget.store.ts` 维护 Agent activity 列表、加载/错误状态、项目偏好和 Session 已读操作。

页面监听：

- `agent:status`
- `session:activity`
- `session:done`
- `session:changed`
- `task:update`

收到事件后重新拉取小型摘要，不下载完整 Session 事件或消息内容。

## Electron 集成

Electron 创建 `300 × 360`、无边框、不可调整大小、透明且可置顶的 Widget 窗口。React 页面将 `html`、`body` 和 `#root` 背景设为透明，Widget 容器使用 backdrop blur 和半透明表面。单个主题按钮在亮色、黄色和深色之间循环，选择结果保存在当前桌面连接 origin 的 localStorage。

点击 Agent 时：

1. 前端调用 `window.electronWidget.openMain({ projectId, sessionId })`。
2. Electron 加载 `/p/:projectId/workspace?sessionId=...`。
3. 只有导航成功后，前端才调用 `widget.sessions.markRead`。
4. 导航失败时保留未读状态并显示错误。
