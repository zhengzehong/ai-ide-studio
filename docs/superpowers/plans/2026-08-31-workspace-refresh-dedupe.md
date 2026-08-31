# Workspace 刷新去重实施计划

## 目标

修复 PC Workspace 中会话同步和任务加载状态持续闪烁的问题：同一资源的恢复请求合并，保留真实断线与事件缺口恢复能力。

## 范围

1. Session store：按 `sessionId` 复用正在执行的 `fetchMessages` 请求，避免 `session:activity idle` 与 `session:done` 重复拉取。
2. Workspace task pages：按 tab 复用正在执行的非追加刷新，避免 `reconnected` 与 `resync_required` 连续触发时反复 abort/restart。
3. Realtime recovery：同一时间窗口只允许一个当前会话恢复流程，后续触发复用已有恢复 Promise。
4. 测试：覆盖并发消息加载、结束事件重复刷新、任务页刷新去重和恢复流程不丢失。

## 验收标准

- 同一 `sessionId` 在已有请求未完成时重复调用 `fetchMessages`，底层消息查询只执行一次。
- 一轮会话结束收到 idle/done 两个事件时，不出现连续的消息 loading 请求。
- 同一任务 tab 的并发刷新只保留一个底层请求，刷新完成后仍正确更新数据。
- WebSocket 重连和 `resync_required` 仍能恢复当前会话与项目数据。
- 不改变 ACP、任务状态机和数据库协议。

## 验证命令

- `npx vitest run tests/unit/session-message-load-state.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/app-runtime-bootstrap.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
