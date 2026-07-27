# WebSocket 重连后会话校准实施计划

## 目标

WebSocket 重连成功后，不依赖 `resync_required`，主动将会话列表、当前消息和 recovery 与服务端持久化状态校准，清除休眠或断网期间遗漏 `session:done` 导致的假运行状态。

## 实施步骤

1. 在应用运行时恢复模块提取统一的当前会话校准函数。
2. `reconnected` 路径先强制刷新项目数据，再刷新当前会话 messages 与 recovery。
3. `resync_required` 复用相同校准函数，保留在线事件缺口恢复职责。
4. 增加重连后 completed 消息覆盖旧 streaming 状态的回归测试。
5. 运行全量测试、Lint、TypeScript 与生产构建，提交后合并到 `prd`。

## 验收标准

- WebSocket 重连后自动刷新当前会话，无需手动刷新页面。
- 服务端已经完成的消息会清除本地 streaming/running 假状态。
- `resync_required` 行为不回归。
- 不修改数据库、ACP 或服务端实时协议，不重启在线服务。
