# 桌面 Widget 当天任务与未读运行态精简

## 目标

让桌面 Widget 只承担当前需要关注的会话提醒：只显示运行中的 Session 或有新回复的未读 Session；关联 Task 仅展示按 Workspace 口径在本地当天创建的任务。

## 实施步骤

1. 调整 Widget Session 查询与聚合：移除 `needs_input/blocked` 作为独立可见条件，补充 Task 创建时间并隐藏跨天任务信息。
2. 调整前端类型、筛选和已读后的本地移除逻辑：保留“全部/运行中/未读”，点击已读空闲会话后移除。
3. 补充聚合、RPC、store 和筛选回归测试，覆盖历史待确认任务、当天任务、已读和运行中行为。
4. 更新 Widget 设计/实现文档，执行定向测试、全量测试、lint、build 和 diff 检查。
5. 完成独立代码审查后合并到 `prd`，不启动或重启任何服务。

## 验收标准

- 历史 `needs_input/blocked` Task 不会单独让 Widget 条目出现。
- 只有 `running` 或 `unread` Session 进入正式 Widget 聚合。
- 跨天 Task 不显示标题/状态，不作为可见条件；当天 Task 与 Workspace 的 `created_at` 口径一致。
- 点击空闲未读 Session 并成功导航后，条目从 Widget 消失。
- 点击运行中 Session 后仍保留；完成后新回复按未读重新出现。
- 不新增数据库迁移，不影响普通 Workspace 的任务筛选。
