# 2026-06-05 Chat turn elapsed chip restore

## 目标

恢复对话消息统计条最左侧的耗时显示，不能影响现有 token / 缓存 / 费用统计展示。

## 根因假设

完成后的历史消息会从后端 `sessions.messages` 重新加载。前端实时 `session:done` 临时写入的 `decision_json.elapsedSeconds` 可能被后端持久化消息覆盖，而后端消息已有 `started_at` / `completed_at`，但渲染层没有用它们兜底计算耗时。

## 执行步骤

1. 定位统计条渲染和消息时间字段来源。
   - 验证：确认 `Workspace.tsx` 只在 `turnStats.elapsedSeconds` 或流式计时存在时显示耗时。
2. 增加最小兜底：历史/完成消息没有 `elapsedSeconds` 时，用 `started_at` 与 `completed_at` 计算耗时。
   - 验证：新增单元测试覆盖时间兜底、非法时间、不覆盖已有统计耗时。
3. 保持 UI 结构不变：耗时 chip 继续位于统计条最左侧。
   - 验证：构建和 lint 通过。
4. 提交 master 并合并到 prd。
   - 验证：`npm run build`、`npm run lint`、`npm test`、`git diff --check`。
