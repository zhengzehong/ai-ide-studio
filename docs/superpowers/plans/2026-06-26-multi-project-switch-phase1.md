# 多项目切换体验优化 - 阶段 1

> 日期：2026-06-26 | 分支：`worktree-dev-pc` | 关联 PM 任务：`task-401b97cb` | 执行任务：`task-1bd30015`

## 目标

把"多项目切换从 3 步降到 1 步"。新增固定项目 Tab、快捷键、上一个项目回切、项目视觉标识(颜色 + emoji),并把项目列表默认排序改为按最近访问时间。

## 实施清单

### L3.1 — DB 字段扩展

- 新增迁移 `src/store/migrations/007-project-meta.ts`:为 `projects` 表加 4 列 `color` / `icon` / `last_visited_at` / `visit_count`
- `src/store/migrations/index.ts`:注册 007 迁移
- `src/store/projects.ts`:`ProjectRow` 与 `CreateProjectInput` 同步加字段;`list()` 排序改为 `(last_visited_at IS NULL) ASC, last_visited_at DESC, created_at DESC`;新增 `touchVisit(id)` 方法写入访问时间 + 计数
- `tests/integration/sqlite-migration.test.ts`:更新期望的 migration 版本数组

### L3.2 — RPC 补齐

- `src/gateway/rpc/projects.ts`:
  - `projects.create` 接收 `color` / `icon`
  - `projects.update` 接收 `color` / `icon`
  - 新增 `projects.select` handler,内部调 `projectStore.touchVisit`

### L1.1 — 项目 Tab 固定

- 新建 `ui/src/utils/project-meta.ts`:
  - `PROJECT_COLORS`(8 色)/ `PROJECT_ICONS`(20 个 emoji)预设
  - `hashString` / `autoColor` / `autoIcon` —— 用户不选时按项目名 hash 自动出颜色 + 图标
  - `resolveProjectColor` / `resolveProjectIcon` —— 优先用项目字段,缺失则用自动值
  - `usePinnedProjects` zustand store —— `pinnedIds` / `togglePin` / `reorder` / `isPinned`,持久化到 `localStorage: ai-ide-pinned-projects`,上限 5 个
  - `MAX_PINNED = 5`
- `ui/src/components/layout/AppLayout.tsx`:新增 `<ProjectTabBar />` 组件,挂在 top-bar 下方
  - 渲染固定 Tab,显示 emoji + 颜色 + 名字 + 关闭按钮
  - 右键 Tab 取消固定
  - 拖拽排序(HTML5 drag events)
  - 超过 5 个折叠为"更多 ▾"
  - 下拉中右键项目项 = 固定/取消固定,已固定的显示 📌
- `ui/src/components/layout/AppLayout.css`:新增 `.project-tab-bar` / `.project-tab` / `.project-tab-icon` / `.project-tab-close` / `.project-tab-overflow` / `.project-tab-overflow-menu` / `.project-tab-prev` 等样式

### L1.2 — 快捷键

- 在 `<ProjectTabBar />` 内 `useEffect` 注册全局 keydown:
  - `Cmd/Ctrl + 1~5` → 切到第 N 个固定 Tab
  - `Alt + ←` → 切到上一个项目
  - `Cmd/Ctrl + K` → `alert('命令面板开发中')`(占位,阶段 2 再做)

### L1.3 — "上一个项目"回切

- `ui/src/stores/project.store.ts`:`ProjectStore` 加 `previousProjectId: string | null` 字段;`selectProject(id)` 在切换前把旧 `currentProjectId` 写入 `previousProjectId`,同时异步调 `projects.select` RPC 触发后端 `touchVisit`;`deleteProject` 在删除当前项目时也清掉 `previousProjectId` 如果指向被删项目
- `<ProjectTabBar />` 末尾渲染"← 上一个:项目名"按钮,无上一个时隐藏

### L1.4 — 项目视觉标识

- `<ProjectSwitcher />` 顶部按钮:用 `<ProjectMetaBadge>`(emoji + 颜色)替换原来的 `FolderOpen` 图标
- 下拉项:用 22×22 的 `<ProjectMetaBadge>` 替换原来的 8px 圆点
- 新建项目表单:加 `<ProjectMetaPicker />` —— 8 色色板 + 20 个 emoji 选,默认按项目名 hash 自动出值,通过 hidden input 提交 `color` / `icon`

## 验收清单

- [x] 顶部有固定项目 Tab 栏,可右键固定/取消,可拖拽排序,上限 5 个
- [x] `Cmd/Ctrl + 1~5` 切到对应 Tab,`Alt + ←` 回切上一个项目
- [x] "← 上一个:项目名"按钮可见且可点
- [x] 新建项目时可选颜色 + emoji,不选时自动生成
- [x] Tab / 下拉 / 固定 Tab 都显示颜色 + 图标(不再全是绿点)
- [x] 下拉按 `last_visited_at DESC` 排,切换项目后顺序会变
- [x] `npm test` 通过(已修迁移版本断言;`runtime-registry.test.ts` 的 1 个失败在改动前就已存在,与本任务无关 —— 已用 `git stash` 在干净 HEAD 上验证)
- [x] `npm run lint` 无新增错误
- [x] `npm run build` 通过
- [x] 改动写到此 plan 文档

## 验证步骤

1. `cd .claude/worktrees/dev-pc`
2. `npm run build` —— TypeScript + Vite 全过
3. `npm run lint` —— ESLint 全过
4. `npm test -- --run` —— 181 passed,1 failed(预先存在的 `runtime-registry` 失败,与本任务无关)

## 改动文件清单

**后端:**
- `src/store/migrations/007-project-meta.ts`(新增)
- `src/store/migrations/index.ts`
- `src/store/projects.ts`
- `src/gateway/rpc/projects.ts`

**前端:**
- `ui/src/utils/project-meta.ts`(新增)
- `ui/src/stores/project.store.ts`
- `ui/src/components/layout/AppLayout.tsx`
- `ui/src/components/layout/AppLayout.css`

**测试:**
- `tests/integration/sqlite-migration.test.ts`(更新版本断言)

**文档:**
- `docs/superpowers/plans/2026-06-26-multi-project-switch-phase1.md`(本文档)

## 已知问题

1. `runtime-registry.test.ts > prefers local installed ACP adapter over npx fallback` 失败 —— 这是环境问题(本机 `codex-acp` 的 npx fallback args 非空),与本任务改动无关。已通过 `git stash` 在干净 HEAD `9ccc382` 上验证该测试同样失败。
2. 项目编辑入口(改颜色/图标)暂未做 —— 当前只能在新建时选。后续可在项目设置页加编辑入口。
3. 拖拽排序用原生 HTML5 drag events,在触屏设备上不工作。后续如需支持触屏,可换 dnd-kit。
4. `Cmd/Ctrl+K` 仅占位 alert,命令面板本身在阶段 2 实现。

## 下一步(等用户确认)

- 阶段 2:命令面板(Cmd/Ctrl+K 全局搜索 + 切换)
- 阶段 3:项目状态角标 + 跨实体搜索 RPC
- 把改动合并到 `prd` 分支(等用户审查后)
