# 灵感任务新会话派发修复

## 目标

修复灵感候选任务选择“自动新建会话”后仍回退到 Agent 主会话的问题，确保立即执行和稍后启动都遵守 `new_each`。

## 范围

- 保留普通任务、定时任务和已有会话复用逻辑。
- 不修改全局 `step-dispatch` 的主会话回退策略。
- 不新增数据库字段或迁移。

## 实施步骤

1. 增加回归测试：存在 primary session 时，灵感 `new_each` 立即执行与草稿启动都必须使用新 session。
2. 将灵感任务的会话模式传入通用 simple task 创建边界。
3. 让 simple task 在显式 `new_each` 下先创建并绑定新 session，再走既有 step dispatch。
4. 运行定向测试、全量测试、lint、build 和 diff 检查。
5. 完成代码审查后提交，并以 no-ff 合并到 `prd`，不重启 PRD 服务。
