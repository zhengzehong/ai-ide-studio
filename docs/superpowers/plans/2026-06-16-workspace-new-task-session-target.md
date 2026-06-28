# Workspace 右侧新建任务会话目标补漏计划

## 目标

会话页右侧任务面板的“新建任务”弹窗与任务页保持同一套会话投递模型：指定已有会话、每次新会话、固定新会话。

## 步骤

- [x] 给 Workspace 新建任务的会话参数转换补单元测试。
- [x] 在 Workspace 新建任务弹窗中增加三态会话目标选择，并透传 `sessionMode/sessionId`。
- [x] 运行针对性测试、构建或 lint 校验。
- [ ] 提交主分支 commit，并 cherry-pick 更新本地 `prd` 分支。
