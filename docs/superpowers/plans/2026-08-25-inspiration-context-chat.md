# 灵感上下文对话与方案修订实施计划

## 目标

- 灵感结果页可以进入项目长期灵感会话继续讨论，发送消息时由平台可信地携带当前 `noteId`。
- AI 通过 `inspiration.note.get` 读取当前灵感，通过现有 `inspiration.analysis.publish` 发布修订结果。
- `analysisAttemptId` 只作为后端内部轮次，不再出现在 AI 工具参数中。
- 修订失败、未调用 publish 或服务中断时保留当前已发布方案；正常结束后才生成新版本。
- 所有灵感工具只对项目灵感会话可见，不注入普通 Agent 会话。

## 实施清单

- [x] 增加 migration 054 和独立修订草稿状态，保持已发布结果可见。
- [x] 重构灵感整理和讨论为同一项目串行队列，禁止跨 `noteId` 批处理合并。
- [x] 新增 `inspiration.note.get` 只读工具并收紧灵感工具可见性。
- [x] 从 publish schema 移除 `analysisAttemptId`，由后端解析当前内部轮次。
- [x] 扩展会话发送协议，支持可信 `inspirationNoteId` 和隐藏模型上下文。
- [x] PC 灵感结果页增加“继续讨论”，导航到现有长期会话并携带 `noteId`。
- [x] 补充自动整理、交互修订、失败保留、跨灵感串行、工具隔离和 PC 跳转测试。
- [x] 更新数据模型、WS 协议、工具平台、架构总览和 README。
- [x] 运行定向测试、全量测试、类型检查、lint、build 和 diff-check。
- [x] 完整代码审查；提交和非破坏性合并 `prd` 作为最后交付步骤，不重启在线服务。

## 验收标准

- 普通 Agent 会话不包含 `inspiration.note.get` 或 `inspiration.analysis.publish`。
- 灵感会话中两个工具均可见，AI 不需要传 attemptId。
- 从任意灵感结果进入会话后，每条消息都绑定该 `noteId`，切换其他灵感后不会串线。
- 同一轮多次 publish 只提交最后一份有效结果；无 publish、失败或重启不覆盖旧方案。
- 修订成功后 `analysisRevision` 增加一次，已派发 Task 的历史关联不被删除。
