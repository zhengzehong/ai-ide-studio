# 团队群聊任务安排展示修复

## 目标

- 团队群聊继续使用通用 `ConversationPane`，普通 Workspace 产品逻辑不变。
- Master 派发给成员的内部 prompt 不再以用户气泡显示。
- 成员回复块顶部显示可折叠的任务安排内容。
- 成员执行失败显示明确错误态；composer 字体声明与 Workspace 的继承行为一致。

## 实施顺序

1. 后端为成员派发 prompt 写入 `sender_role=team-assignment`、`sender_name=Master`，同时保留完整模型 prompt。
2. 团队聚合适配器过滤安排消息并绑定到同一成员的下一条 agent 消息，兼容旧历史结构化文本。
3. 通用消息组件增加可选 `teamAssignment`，只有团队消息传入时渲染折叠安排块；普通 Workspace 不传。
4. 失败消息和 streaming failed 状态使用错误样式，不改错误内容。
5. 修复通用 composer 的字体声明，补充聚合、渲染和后端参数测试。

## 验收

- 用户消息只显示一次；安排消息不显示为“你”。
- 成员块顺序为“Master 安排的任务（默认折叠）→执行过程/工具→成员回复”。
- 历史与实时成员消息都能显示，空安排、无后续回复和旧历史不崩溃。
- 失败内容可见且有错误视觉。
- `npm test`、`npm run lint`、`npm run build` 通过。
