# 桌面悬浮部件（Desktop Widget）设计文档

桌面悬浮部件是 Electron 模式下的常驻迷你窗口，用于在不切回主窗口的情况下查看 Agent 会话进度，并快速添加或查看任务。

## 设计原则

- **会话优先**：Agent Tab 展示的是活跃或未读的 Session，Agent 名称只是 Session 的归属信息。
- **轻量进度**：Widget 展示阶段、运行状态、未读状态和所属项目，不承载完整聊天历史。
- **任务直达**：任务面板复用 Task 系统，支持按项目查看、快速创建和 Agent 分派。
- **可恢复偏好**：固定项目和固定 Agent 保存到本地数据库，重启后恢复。

## 窗口结构

```text
┌──────────────────────────────┐
│ ● [全部项目▾]          −  ↗  │
├──────────────────────────────┤
│ Agent [2]       任务 [4]      │
├──────────────────────────────┤
│ 🤖 Codex        ide     2:15  │
│    修复登录问题              │
│    正在思考...               │
│                              │
│ 🤖 Claude       docs    5m前 │
│    README 更新               │
│    已完成 · 未读             │
└──────────────────────────────┘
```

任务面板：

```text
┌──────────────────────────────┐
│ Agent [2]       任务 [4]      │
├──────────────────────────────┤
│ [待办] [进行中] [全部]        │
│ ○ 补充单元测试               │
│   待办 → test-runner         │
│ ● 修复构建失败               │
│   执行中 → backend-dev       │
├──────────────────────────────┤
│ [新建任务...] [Agent▾] [+]   │
└──────────────────────────────┘
```

## Agent Tab 显示规则

Agent Tab 默认只显示：

- 正在执行的 Session。
- 已完成但未查看的 Session。

每条 Session 显示：

- Agent 图标和名称。
- 项目名。
- Session 标题，优先使用会话标题，其次使用关联任务标题。
- 进度描述：运行中显示 `sessions.stage`，未读完成显示“已完成 · 未读”。
- 时间：运行中显示已用时，完成后显示距今时间。
- 状态点：绿色表示运行中，蓝色表示已完成未读。

点击 Session 后：

- Widget 调用已读 RPC 标记该 Session 已读。
- Electron 主窗口打开并定位到对应 Workspace Session。

## 任务面板

任务面板复用 `tasks` 表和 `tasks.*` RPC。

筛选规则：

- **待办**：`backlog`
- **进行中**：`executing`、`needs_input`、`reviewing`、`blocked`
- **全部**：当前项目下全部任务，包含 `completed` 和 `cancelled`

快速创建任务：

- 输入标题后回车或点击 `+` 创建。
- Agent 下拉只显示当前固定项目内可用 Agent。
- 固定 Agent 不属于当前项目时自动清空，避免跨项目误分派。
- 创建时调用 `tasks.create`，携带 `title`、`assignAgentId` 和 `projectId`。

## 偏好

Widget 保存两类偏好：

- `pinnedProjectId`：固定项目，影响 Agent Tab 和任务面板的过滤。
- `pinnedAgentId`：固定任务创建时的默认分派 Agent。

偏好存储在 `widget_preferences` 表中。

## 技术通信

- Session 列表：`widget.sessions.list`
- Session 已读：`widget.sessions.markRead`
- 偏好读取/保存：`widget.preferences.get` / `widget.preferences.set`
- 任务列表与创建：复用 `tasks.list` / `tasks.create`
- 实时刷新：监听 `session:activity`、`session:done`、`session:changed`、`agent:status`、`task:update`

Widget 不订阅完整 `session:update` 流。完整聊天内容仍由 Workspace 负责。

## Electron IPC

| Channel | 用途 |
| --- | --- |
| `widget:minimize` | 隐藏悬浮窗口 |
| `widget:toggle-pin` | 切换窗口置顶 |
| `widget:open-main` | 激活主窗口，可携带 `sessionId` / `projectId` 定位会话 |
