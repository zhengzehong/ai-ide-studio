# sessionDock.list 后端性能修复

## 目标

消除 `sessionDock.list` 摘要查询扫描大量 `session_events` 导致的 API 事件循环冻结，同时保持 PC/APP 的置顶会话展示和状态语义不变。

## 范围

- 修改 `src/store/global-session-dock.ts` 中最新完成事件的查询方式。
- 增加回归测试，验证按事件序号取最新 `message.done`，并覆盖查询字段语义。
- 不修改前端、WS 协议、数据库迁移和在线 PRD 数据。
- 保留现有失效置顶记录清理逻辑，本轮不改变清理时机。

## 实施步骤

1. 阅读现有 session dock store 与测试，确认事件序号和完成事件语义。
2. 先增加会在旧查询上失败的回归测试。
3. 将 `MAX(created_at)` 改为基于 `(session_id, sequence)` 索引的倒序 `LIMIT 1` 查询。
4. 运行定向测试、全量测试、lint、类型检查、构建和 diff 检查。
5. 复核返回字段、排序、未读和运行状态无行为变化，提交并合并 `prd`。

## 验收标准

- `sessionDock.list` 不再为每个置顶会话扫描全部历史事件。
- 最新完成事件与原语义一致，空结果仍为 `null`。
- PC/APP 现有展示和交互不变。
- 所有验证通过，且不重启 PRD 服务、不修改在线数据库。
