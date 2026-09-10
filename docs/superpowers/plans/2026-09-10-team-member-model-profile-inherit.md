# 团队成员模型档案继承实施计划

## 目标

让团队成员默认沿用 Master 的有效模型档案，同时允许 Master 在创建成员时传入兼容的模型档案 ID。成员和 Master 都没有档案时继续沿用当前运行时系统环境，不改变普通 Agent/Workspace 行为。

## 实施清单

1. 扩展 `team.member.spawn` 的输入类型、工具 schema 和执行器，支持可选 `modelProfileId`，校验 runtime 匹配。
2. 在团队成员绑定上保存成员级模型档案覆盖；未设置时按 Master 档案解析，避免修改可被多个团队复用的 Agent 全局配置。
3. 在运行时快照中将团队成员的有效档案覆盖传给模型环境解析；无覆盖且无 Master 档案时保留现有系统环境回退。
4. 让 Master 的系统提示和模型档案查询工具说明明确：先调用 `core.model_profile.list`，再把返回的档案 ID 传给 `team.member.spawn`。
5. 增加数据库迁移、单元/集成测试，覆盖继承、显式覆盖、无档案回退、非法 runtime 和查询提示。
6. 运行 `npm test`、`npm run lint`、`npm run build`、UI TypeScript 检查，审查后合并 `prd`。

## 验收标准

- 未传 `modelProfileId` 的成员使用 Master 当前固定档案。
- 传入 `modelProfileId` 的成员使用指定档案，不影响 Master 或其他团队。
- Master 与成员都没有档案时，`buildAgentRuntimeEnv` 行为与现状一致，继续使用进程环境。
- Master 知道先调用 `core.model_profile.list` 查询，并将 `modelProfileId` 传给 `team.member.spawn`。
- 普通 Agent、Workspace 和现有团队会话无行为回归。
