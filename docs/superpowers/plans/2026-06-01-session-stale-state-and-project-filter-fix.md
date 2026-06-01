# 会话卡住与项目会话过滤修复计划

日期：2026-06-01

## 目标

1. 后端重启、热更新或 Agent 进程异常退出后，不再把历史会话永久显示为“正在思考...”。
2. 工作台会话列表始终只显示当前项目的会话，避免刷新/切换时短暂或偶发显示全局会话。

## 根因证据

- `data/ai-ide.sqlite` 中 `sess-71bd4c2f` 的最后阶段为 `正在思考...`，事件流停在 `lifecycle.prompt_sent`/`commands.update`，没有后续 `message.done`。
- 日志显示该 prompt 发出后服务发生重启，内存里的 `activePrompts` 和 ACP promise 丢失，DB 中 `sessions.stage` 没有启动态修正。
- `Workspace` 渲染 `sessions` store 时只按 `agent_id` 分组；如果全局初始化或旧请求把全量 sessions 写进 store，工作台没有按 `currentProjectId` 再过滤。

## 实施步骤

1. 新增后端 store 方法清理中断阶段：只处理 active 会话且 stage 属于运行中 lifecycle 文案。
2. 在 `startApp()` 初始化 DB 后调用该清理方法，并记录结构化日志。
3. 前端 session store 增加请求序号与项目作用域字段，丢弃过期 `sessions.list` 响应，并提供按项目替换/事件过滤能力。
4. `Workspace` 渲染时用当前项目过滤 sessions，切换项目时清理不属于当前项目的选中会话。
5. 增加回归测试：
   - store 启动态清理只影响运行中 active 会话。
   - reducer 遇到 `lifecycle.interrupted` 不恢复 streaming。
   - Workspace helper 的项目过滤只保留当前项目会话。

## 验收

- 针对性测试通过。
- `npm test`、`npm run build`、`npm run lint` 通过。
