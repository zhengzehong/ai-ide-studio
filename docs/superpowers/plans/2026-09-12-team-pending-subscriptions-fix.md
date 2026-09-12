# 团队准备占位与实时订阅修复

任务：task-3a157669 / step-af94b774。基线：prd / 50975cd。

## 目标与边界

修复已复现的旧 RPC 覆盖订阅、团队历史恢复误判；PC 接入团队补同步，准备状态只显示一处。沿用现有消息组件与派发逻辑，无数据库迁移。不重启或打断 PRD 实例。

## 执行清单

- [x] 先补失败测试：查询返回与订阅/取消交错，历史已完成但开始时间早于用户消息，下一轮输入保护。
- [x] 实时订阅修复：只应用 RPC 的真实订阅变化，保护请求期间发生的显式 subscribe/unsubscribe。
- [x] 团队占位修复：以持久化用户事件和回合消息关联识别实际回答，不以 started_at 比较猜测。
- [x] PC 团队恢复：处理 resync 与 visibilitychange，保留历史/实时合并竞态守卫。
- [x] 准备文案精简：保持普通 Agent 渲染兼容。
- [x] 定向测试与隔离浏览器验证：准备→真实进展→完成；Master 完成、成员继续；恢复和连续发送。
- [x] npm test、npm run lint、npm run build、服务端/UI/mobile tsc、git diff --check。
- [ ] 独立审查，修复审查发现的问题，提交并合并 prd，核实主仓库并行 WIP 未变。

## 涉及模块

- src/realtime/hub.ts、process-client.ts、service.ts：订阅桥接，沿用既有 IPC 字段。
- ui/src/components/team/team-chat-pending.ts、team-chat-state.ts、TeamChatPane.tsx：占位关联与恢复。
- ui/src/components/chat 中阶段摘要的团队可选行为。
- tests/unit、tests/integration 中对应回归；必要的内部协议架构说明。

## 验收

- 只读查询晚返回时，新增订阅仍收到事件，取消订阅不复活。
- 创建/fork/关闭等 RPC 的真实订阅变化保持有效。
- 已回答的准备占位被清除，历史晚到不清掉下一轮等待。
- PC 团队补同步恢复自己的 snapshots；Master 完成不随成员持续显示运行。
- 过程折叠、成员身份和普通 Agent 行为保持兼容。

## 验证记录

- 修复前：新增 6 项订阅竞态与 2 项准备占位测试均失败；修复后通过。
- 隔离浏览器：`node scripts/verification/team-pending-browser.mjs`，真实 TeamChatPane 组件配模拟传输，覆盖准备单处、PC 补同步、成员独立运行、上一轮 done 晚到、完成后正文保留及切换。截图输出 `.tmp/team-pending-browser/`，不连接 PRD。
- 只读回放原截图 Master 的持久化消息及事件：running=false、pending=null、正式回复 1 条且正文保留。
- 首次默认并发全量测试：469 文件中 1 文件、2 用例失败，为模型代理 Runtime 退出/清理时序；该文件单独重跑 2/2 通过。
- Lint、build（包含服务端及 PC/APP TypeScript）、UI tsconfig.app.json 检查通过。
- 全量复跑：`npm test -- --maxWorkers=2`，469 文件 / 2601 用例全部通过，EXIT=0。Mobile tsconfig.app.json 与 diff-check 通过。
- 审查与合并完成状态以 task-3a157669 的后续报告记录。
