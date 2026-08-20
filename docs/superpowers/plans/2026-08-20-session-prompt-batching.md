# Session Prompt 下一批合并派发

## 目标

当同一 Session 正在执行一轮 Agent 工作时，用户、Agent 和平台后续输入不再逐条形成新的 Agent turn。当前轮结束后，冻结这一段时间的输入并合成为一次下一轮 Prompt。

同时，定时规则在目标 Session 忙碌或已有待处理触发时保持单飞：同一规则只保留一次待执行触发，不能按周期累积多个重复任务或 Prompt。

## 范围

- 将 Session 后续 Prompt 队列从 Promise 链改为可冻结的 next-batch。
- 忙碌时接纳用户 Prompt，返回“已排入下一轮”，不再拒绝。
- 以 `clientMessageId` / Agent message ID 做输入幂等。
- 将 Agent 消息、reply reminder、watch、规则唤醒接入 next-batch，并按稳定键合并平台重复事件。
- 对 `send_prompt` 和 `create_task` 规则加入执行中/待执行单飞保护。
- 维持 Session 每次仅有一个 active prompt，且不改变 ACP 调用方式。

## 非范围

- 不实现 Claude/Codex 原生 mid-turn steer。
- 不新增持久化 Inbox 或跨重启恢复队列。
- 不改变 Agent 工具、任务状态机或 Runtime 进程生命周期。
- 不重启 PRD 服务。

## 执行步骤

- [x] 梳理 prompt 命令、Session 队列与规则执行现有测试，新增 busy-window 批次复现用例。
- [x] 实现 Session next-batch 聚合、冻结、单次派发和每个输入的完成/失败 fan-out。
- [x] 让用户 Prompt 在 Session 忙碌时入下一批，并向 PC/App 命令层保留 accepted 语义。
- [x] 接入 Agent 消息、提醒/watch 与规则唤醒的幂等键和批次合并。
- [x] 为重复 `send_prompt` / `create_task` 规则加入单飞保护。
- [x] 补单元/集成测试，运行 lint、build、全量测试与 diff 检查。
- [ ] 自审改动、提交分支并合并回 `prd`，不重启服务。

## 验收

- 当前 turn 执行期间连续 30 次相同定时唤醒，只产生一次下一轮 Prompt。
- 当前 turn 执行期间的多条用户与 Agent 消息保留内容，但只触发一次后续 Agent turn。
- 批次开始后新输入不会混入，进入下一批。
- 同一 message ID 或同一平台 dedupe key 不会重复进入批次。
- `create_task` 规则忙碌期间不重复创建任务。
- Prompt 执行失败时，调用方能得到失败，队列可以继续处理后续批次。
- 现有直接空闲 Prompt、取消和 Session 完成行为不回归。
