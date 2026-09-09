# 团队群聊复用 Workspace 对话界面实施计划

## 目标

- 左侧团队会话使用普通 Workspace SessionBar 的行结构和操作语义。
- 中间保留现有通用 ConversationPane/消息卡片/输入框能力，团队只提供多 Agent 消息适配。
- 一个用户消息对应一个 Agent 顶层回复；工具调用、思考、文件变更属于该回复内部。
- 普通 Workspace 的业务状态和产品行为不改变。

## 约束

- 仅前端改动；不改数据库、ACP、后端协议。
- 从最新 `prd` 独立 worktree 开发；审查通过后再合并。
- 不把全局单会话 store 同时复用给多个成员；每个成员保留来源和稳定 messageId，聚合只在 adapter 层完成。

## 实施顺序

1. 抽取可复用的会话列表行视图，普通 Agent 与团队会话使用相同样式，团队保留自己的加载和 RPC 行为。
2. 抽取通用 ConversationSurface，把消息列表、执行过程、composer 和滚动作为稳定 UI；先以兼容 adapter 接入普通 Workspace，确认行为不变。
3. 重做 TeamConversationAdapter：每个 Agent 的最终消息和 active turn 按 messageId 归并，再将多个 Agent 的顶层消息按时间合并；不把工具事件单独变成 AI 消息。
4. 补充团队消息、单 Agent 回归和组件渲染测试。
5. 运行定向测试、全量测试、lint、build，做 diff 审查后提交。

## 验收

- 团队列表行尺寸、状态点、重命名/归档/删除/新建与普通会话一致。
- 一次发送只出现一条用户消息；Master 或成员各自最多一条对应回复。
- 同一回复内展示思考、工具调用、工具结果和最终回答；执行中到完成不重复。
- 普通 Workspace 的历史消息、流式输出、工具详情、附件、自动滚动、输入框回归通过。
- 无后端、数据库、普通 Workspace 业务逻辑变更。
