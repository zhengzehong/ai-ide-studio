# 四步架构改造计划

创建时间：2026-05-29 01:36

## 目标

按当前真实代码逐步降低后续开发复杂度，避免继续向 `ws-handler.ts`、`acp/host.ts`、`Workspace.tsx`、`store/db.ts` 堆功能。

## 步骤 1：拆分 WS RPC

- 将 `src/gateway/ws-handler.ts` 的大 switch 拆到 `src/gateway/rpc/*`。
- `ws-handler.ts` 只保留连接、订阅、广播、解析、dispatch。
- 现有 RPC 名称和行为保持不变。

验证：`npm test`、`npm run build`、`npm run lint`。
提交：`refactor: split websocket rpc handlers`

## 步骤 2：正式化 SQLite migration

- 新增 `src/store/migrator.ts` 与 `src/store/migrations/*`。
- 引入 `schema_migrations` 表。
- 保留旧库兼容，确保空库和已有库都能启动。
- `src/store/db.ts` 降低 schema/迁移职责。

验证：`npm test`、`npm run build`、`npm run lint`。
提交：`refactor: add sqlite migration runner`

## 步骤 3：拆分 ACP host 职责

- 从 `src/acp/host.ts` 拆出 runtime/session/client handler/interaction/terminal/mock 等模块。
- 保持 `acpHost` 外部 API 不变。
- 清理后端非 CLI 的 `console.*`。

验证：`npm test`、`npm run build`、`npm run lint`。
提交：`refactor: split acp host responsibilities`

## 步骤 4：拆分 Workspace 和对话 UI

- 将 `ui/src/pages/Workspace.tsx` 拆到 `ui/src/pages/workspace/*`。
- 保持现有视觉风格和交互不变。
- 对话组件、工具调用、权限/提问、输入区独立。
- 若发现 `ChatView.tsx` 可复用或废弃，先低风险处理，不大范围重写状态逻辑。

验证：`npm test`、`npm run build`、`npm run lint`。
提交：`refactor: split workspace chat components`

## 审查要求

每步完成后：

1. 查看 `git diff --stat` 和关键 diff。
2. 运行验证命令。
3. 确认无未预期功能改动。
4. 单独 commit。
