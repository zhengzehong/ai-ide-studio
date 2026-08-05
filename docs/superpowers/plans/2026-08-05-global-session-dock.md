# 全局会话坞实施计划

## 目标

提供一个不改变 Workspace 会话菜单、排序和聊天状态的跨项目全局会话入口。用户只在右侧全局会话坞内添加、移除和访问常用会话，并看到运行中、未读和最近活动状态。

## 实施步骤

1. 新增 migration 050 和 `global_session_dock` Store，持久化 Session 关系与稳定顺序。
2. 新增轻量查询和 `sessionDock.list/search/add/remove/reorder` RPC，过滤归档、删除、模板、自主和无项目 Session。
3. 新增 `session-dock:update` 全局事件，支持多客户端刷新。
4. 新增 PC `session-dock.store`、右侧入口、抽屉列表和搜索添加视图。
5. 点击会话时关闭抽屉并导航到 `/p/:projectId/workspace?sessionId=...`，复用现有 Workspace 会话链路。
6. 更新 WS、数据模型、架构总览和 README，补充 migration、Store/RPC、状态聚合、互斥抽屉和导航测试。
7. 执行定向测试、全量测试、TypeScript、lint、build 和 diff 检查，完成自审后合并到 `prd`。

## 验收标准

- Workspace 会话菜单、列表顺序和现有 Widget 不发生变化。
- 全局会话坞可以跨项目搜索、添加、移除和排序普通会话。
- 同一 Session 不可重复添加；无效或自主 Session 无法加入。
- 右侧会话坞与全局助理抽屉互斥，列表状态实时更新。
- 点击会话可可靠切换项目并打开指定 Workspace Session。
- 不加载会话历史消息，不创建第二套聊天 Store，不重启 PRD 服务。
