# 对话交互与实时流式设计

## 目标

对话页必须把“历史消息”和“当前最后一轮生成”分开处理：历史负责稳定、轻量、可恢复；当前轮负责即时反馈、流式输出、工具状态和思考过程。用户发送消息后不能出现“先转圈、再消失、最后整段出现”的体验。

## 交互效果

### 发送后立即反馈

用户点击发送后，界面立即追加用户消息，并在下方显示 Agent 当前轮气泡：

```text
Agent · 正在准备 Agent...
```

如果需要启动 runtime 或恢复 ACP 会话，状态可以依次变为：

```text
正在启动 Agent...
正在恢复会话...
正在思考...
生成中
```

隐藏类 lifecycle 事件不能清掉这个当前轮气泡，只能保持已有可见状态。

### 当前最后一轮

当前轮使用独立的 active turn 状态渲染，展示内容包括：

- 文本 `message.chunk` 实时追加。
- Claude Code `thinking.chunk` 实时显示，当前轮默认展开。
- `tool.call` 立即显示工具行。
- `tool.update` 实时更新工具状态、进度、终端输出和错误。
- `session:done` 后将当前轮固化为正式 agent 消息，并清空 active turn。

当前轮是否显示只看当前 turn 是否未完成，不再用历史 messageId/timeline 判断是否“已经展示过”。

### 历史消息

历史消息以 `messages` 表为主数据源，不再依赖完整 event timeline 重放主内容。

历史显示规则：

- 普通 agent/human 消息直接显示。
- 历史 thinking 默认折叠。
- 历史工具调用默认显示摘要或折叠入口。
- 历史工具 raw input/raw output/terminal output 点击后按需加载。
- 最近完成的一条工具消息可以保留完整工具信息，避免刚完成后界面变空。

### 切换会话

切换会话时：

- 只显示选中 session 的消息和 active turn。
- 旧 session DOM 与 streaming 状态不能残留。
- 回到仍在生成的 session 时，继续显示该 session 当前轮状态。

## 数据流

```text
用户发送
  -> 本地追加 human message
  -> 创建 active turn 占位气泡
  -> 后端发送 prompt
  -> ACP sessionUpdate
  -> session:update 实时更新 active turn
  -> session:done
  -> active turn 固化为 message
  -> 拉取 messages/events 做最终同步
```

历史恢复：

```text
选择会话
  -> sessions.messages 加载轻量历史消息
  -> sessions.events 只用于 usage/capabilities/permission 等恢复
  -> 不用历史 event timeline 覆盖已加载的 messages 主视图
```

## 实现原则

1. 每次 prompt 开始创建新的 turn message id；同一轮的 chunk/thinking/tool 共用该 id；下一轮必须换新 id。用户消息使用前端生成的 `clientMessageId`，后端持久化沿用该 id，避免刷新后同一轮重复。
2. 当前轮气泡不参与历史 timeline 去重。
3. `session:event` 可继续用于持久化同步、断线恢复和非实时状态；实时 UI 由 `session:update` 增量驱动。
4. `session:done` 后同时刷新 messages 和 events，保证前端与 SQLite 持久化结果一致。
5. 修复只改当前链路，不回滚历史消息轻量化、工具懒加载和虚拟滚动优化。

## 验收标准

- Codex 简单回复实时流式显示。
- Codex 工具调用实时出现，完成后显示 completed。
- Claude Code thinking 当前轮实时显示。
- 发送后占位状态不消失。
- done 后不闪烁、不重复、不丢工具。
- 历史长会话加载不卡，历史工具调用默认折叠/懒加载。
- 切换会话不串消息。
