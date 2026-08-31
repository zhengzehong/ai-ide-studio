# /updates 左栏层级与流式状态修复

## 目标

- 让项目分组头与 Agent 头像行有明确视觉层级，避免误认为存在没有会话的 Agent。
- 让运行中的对话只显示一个 Workspace 风格的总生成状态，不显示重复的“正在处理...”占位。

## 实施顺序

1. 在 `workbench-ui.test.tsx` 增加项目头语义/样式断言。
2. 在 `conversation-pane.test.tsx` 增加空流式内容只显示一次生成状态的回归断言，并确认有阶段文本时使用阶段文本。
3. 调整 `UpdatesSidebar.tsx` / `updates-sidebar.css` 的项目头表现，不改变分组数据和接口。
4. 调整 `ConversationMessageList.tsx` 的流式消息表现，不改 Workspace 页面和后端。
5. 运行定向测试、全量测试、lint、build、diff check；审查后合并 `prd`。

## 验收标准

- 项目头不再复用 Agent 的彩色头像块，项目计数明确为会话数量。
- 空流式消息不包含“正在处理...”，`conversation-streaming-label` 仅出现一次。
- 流式阶段存在时头部显示阶段文本，否则显示“生成中”。
- 无后端、数据库、Workspace 页面改动。
