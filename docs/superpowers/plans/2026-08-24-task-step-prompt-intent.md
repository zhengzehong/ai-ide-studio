# Task Step Prompt Intent

## 目标

防止任务步骤在 Session 忙时先入队、步骤完成后才发送，导致重复唤醒；同时为后续定时任务、Agent 消息和事件消息提供可复用的 Prompt 意图校验边界。

## 范围

- 为 Session Prompt 增加结构化 `PromptIntent` 元数据。
- 为 task-step 派发增加稳定 dedupe key。
- 在 Prompt 真正发送前校验 task-step 是否仍有效。
- 使用 ready 状态的原子 claim，避免并发重复派发。
- 保持用户消息、定时任务、Agent 消息的现有行为不变。

## 实施步骤

1. 定义 Prompt 意图类型和 task-step validator。
2. 扩展 Session Prompt batcher，仅过滤带 validator 的意图。
3. 在 step dispatch 中加入 claim、dedupe key 和意图元数据。
4. 在步骤完成/取消后让待发送意图通过状态校验自然失效。
5. 增加并发派发、完成后丢弃、正常发送和非 task-step 回归测试。

## 验收标准

- 同一个 task/step/session 的并发 dispatch 最多产生一个有效 Prompt。
- step 在 Prompt 排队期间完成时，旧 Prompt 不再调用 ACP。
- 未完成的 step 仍能正常派发。
- 普通 Prompt batch 行为不变。
- `npm test`、`npm run build`、`npm run lint` 通过。
