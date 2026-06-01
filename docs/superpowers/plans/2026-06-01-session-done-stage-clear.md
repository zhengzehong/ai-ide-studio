# 会话完成后状态清理验证计划

## 目标

验证并修复会话已完成后 `sessions.stage` 仍停留在“正在思考...”的问题，避免前端列表/状态误判仍在生成。

## 步骤

1. 复现实测：向 `sess-71bd4c2f` 重发消息，确认是否有流式输出和 `session:done`。
2. 补测试：构造 `session:done` 后 stage 应清空的单元测试。
3. 最小修复：在 `session:done` 处理链路中只清理运行中 stage，并广播 `session:changed`。
4. 验证：运行新增测试和相关会话测试，并检查目标会话 DB 状态。
