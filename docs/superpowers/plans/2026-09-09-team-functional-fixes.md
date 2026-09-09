# 团队功能问题修复实施计划

## 目标

修复团队 Master 模型档案不可见、团队对话能力低于 Workspace、团队会话列表交互不一致三个问题。保持普通 Agent Workspace 的行为不变，所有改动在团队分支完成后再合并。

## 实施步骤

1. 模型档案：在团队创建 RPC 和表单中支持选择启用的 Claude 模型档案；默认明确显示为全局档案、运行时默认档案或未配置，并将选择写入固定 Master Agent 的 `modelProfileId` 与 `modelProfileMode=fixed`。
2. 对话适配：团队会话继续使用现有 `ConversationPane`，但为 Master 会话接入真实 session store 状态、事件、流式消息、运行状态、能力、用量、权限/询问响应、历史分页、工具过程和文件变更加载；成员历史消息继续以发送者标识合并展示。
3. 会话列表：团队会话列表统一个人 SessionBar 的排序、空态、错误态、刷新、选中、新建、重命名、归档、删除和运行/未读状态样式，保留团队会话 API。
4. 测试与审查：补充模型选择、对话适配和列表行为测试，运行定向测试、全量测试、TypeScript、lint、build，审查 diff 后提交并合并 `prd`。

## 边界

- 不修改 WorkspaceChatPane 或普通 Agent 会话流程。
- 不新增数据库表；团队 Master 的模型选择复用现有 Agent `config_json`，团队表只保留已有 Master prompt。
- Master 运行时固定为现有 Team Leader 的 Claude runtime；不选择 Codex 档案。
- 成员消息仍来自其真实 session 历史，发送入口只向 Master session 发起用户消息。

## 验收标准

- 创建团队时可见并可选择模型档案，默认项和实际生效项一致；错误时显示可操作原因。
- 团队中间区域具备 Workspace 同等的历史加载、执行过程、流式状态、自动滚动、权限交互、用量和文件变更能力。
- 团队会话列表具备个人会话列表的主要交互和状态出口。
- 普通 Workspace 功能无回归，测试、lint、build 全部通过。
