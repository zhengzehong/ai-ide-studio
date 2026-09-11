# APP unified Agent and team conversations

## Scope

Keep Agents and teams in one peer list, distinguished by a type badge. A team owns multiple conversations; internal member sessions must never appear as independent conversations. Preserve ordinary mobile chat behavior and PRD service availability.

## Checklist

- [x] Verify existing list, activity, dock and team APIs; add regression tests before implementation.
- [x] Add a dedicated mobile aggregation API using existing core/store boundaries, without schema changes.
- [x] Integrate mixed project owners, conversation actions and creation with existing mobile rows.
- [x] Integrate team activity and pins, keyed by the Master session for existing dock compatibility.
- [x] Reuse team conversation adapter and mobile chat components for team messages, permissions, history and recovery.
- [x] Verify mixed lists, multiple conversations, hidden members, read/running state, pins, reconnect and ordinary chat regressions.
- [x] Run tests, lint, server/UI/mobile type checks and builds; inspect mobile screenshots.
- [x] Review final diff and prepare the worktree commit for prd. Delivery commit/merge hashes are recorded in the final response after the Git operation.

## Acceptance

No separate Agent/team categories. Project, activity and pinned views consistently represent one team conversation once. Sending targets its Master, members keep sender identity and assignment provenance, and completed output survives reload. Existing ordinary conversations and active services remain usable.

## Tracking limitation

The current tool catalog does not expose AI IDE Studio task/report tools. This plan records the authorized work locally; it is not a replacement claim that a platform task was created.

## 实现与审查记录

- `src/core/mobile-conversations.ts` / `src/store/mobile-conversations.ts` / `src/gateway/rpc/mobile-conversations.ts`：团队目录、隐藏成员关系、owner-only 查询。无数据库迁移，普通消息仍使用现有 API。
- `mobile/src/utils/team-conversations.ts` / `team-list-projections.ts`：Agent 和团队同级合并，群聊去重，内部会话排除，动态按运行/未读筛选，置顶保留 Master Session 键。
- `mobile/src/pages/use-session-list-page.ts`：从原页面拆出控制逻辑；团队的新建、重命名、归档、删除走已有团队 RPC。普通 Agent 的模型档案入口保留。
- `mobile/src/pages/ConversationRoute.tsx` / `components/chat/MobileTeamChatSurface.tsx`：复用团队状态和手机端已有消息/输入/执行过程/附件/预览组件。成员的任务报文展示在成员回复内，用户消息仍只发送给 Master。
- `ui/src/components/team/team-chat-adapter.ts` / `team-chat-history.ts`：从团队容器拆出适配和分页。修正成员交互被误发给 Master、较早历史只沿一个成员加载的问题；持久化最终正文可替换临时流式答案。
- `mobile/vite.config.ts`：共享查询、命令客户端明确使用 APP 的 WS 连接，避免 Android 或远程 APP 错用 PC HTTP 地址及凭据。浏览器测试不替换这两个适配器，只模拟底层 WS 传输。
- 核对 `Workspace.tsx`、普通 `ChatPage.tsx` 和数据库迁移目录零改动；共享修改只涉及团队组件。归档/删除成员不进入普通列表，跨服务器切换忽略旧目录响应，恢复失败不确认 resync 游标。

## 验证方式与边界

最终验证结果：`npm test -- --maxWorkers=4`，460 文件 / 2548 用例全部通过；`npm run lint`、`npm run build`、UI 和 mobile 显式 `tsconfig.app.json --noEmit` 检查、`git diff --check` 均 EXIT=0。生产构建包含 server TypeScript 检查。浏览器回归 EXIT=0。默认高并发全量曾出现既有 `model-proxy-runtime` 临时目录 EPERM 清理失败，降低并发后的完整套件通过，没有修改该 Runtime 测试或生产逻辑。

- 单元/集成测试：目录隔离、多个群聊、active 不等于 running、隐藏关系、置顶投影、权限、刷新竞态、最终消息、来源 Session、成员分页；既有 PC/APP 测试一并回归。
- `node tests/browser/mobile-team-smoke.mjs`：真实列表、路由、TeamChatPane 和手机端组件，模拟 WS 数据；验证新建、Master 发送、成员流式和最终消息、离开再进入、恢复失败/重试、任务展开、动态和置顶；320/390/768 宽度截图和无横向溢出检查。需先在 worktree 启动 `npm run dev -w mobile -- --host 127.0.0.1 --port 5176 --strictPort`。
- 预览地址：`http://127.0.0.1:5176/app/tests/team-smoke.html`，仅测试数据，不连接 PRD。
- 本轮执行代码自审，当前工具不提供平台 code-reviewer 送审事件，因此不声称独立 Agent 已批准。
- 未使用真实 Android 设备或付费模型执行对话；浏览器验证覆盖前端、适配器与传输契约，数据库集成测试使用临时库。实际模型可用性仍取决于已有 Master/成员档案。
- 不重启现有服务、不覆盖在用产物、不改主仓库无关 WIP；部署需要更新后端构建和 APP 前端。Android 安装包需另行构建更新。
