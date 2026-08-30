# /updates 历史执行过程对齐计划

## 目标

让 `/updates` 中间对话区正确呈现 Workspace 已支持的历史执行过程和事件时间线，同时保留 Workspace 原页面实现不变。

## 范围

- 使用现有 `ChatRenderItem`、`buildChatTimelineFromEvents` 和 `groupChatTimelineItems`。
- 通用组件支持时间线组、历史工具调用、文件变更、预览/文件展示、附件和统计。
- workbench store 恢复运行中消息的 process blocks，并按事件 reducer 更新 streaming/plan/usage/capabilities。
- 复用现有 WS/query RPC，不改后端协议。
- 补充 `/updates` 专用回归测试和通用组件测试。

## 不变项

- 不修改 `Workspace.tsx`、后端、`index.css`、App 壳层。
- 不改变 Workspace 的产品行为。

## 验收

1. 历史消息存在 process count 但未加载详情时，打开执行过程会加载并显示工具/文件/计划等 blocks。
2. 只有 session events 的历史执行过程仍能显示 timeline group，而不是空白。
3. 运行中会话重新选择后会恢复 process items 和 lifecycle stage。
4. 会话切换、加载更多和流式更新保持在底部时自动滚动，用户上翻时不抢滚动位置。
5. `/updates` 的附件、预览/文件卡片、token/耗时统计和阻塞交互均有渲染出口。
6. 定向测试、lint、build 通过；提交前审查 diff，确认 Workspace 未被修改。
