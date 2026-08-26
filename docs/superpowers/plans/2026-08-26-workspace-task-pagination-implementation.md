# Workspace Task Pagination Implementation Plan

> Execute this plan in `feat/workspace-task-pagination`. Keep `tasks.list` and all task write paths unchanged.

## Goal

Add a separate cursor-paged task read path, use it for the Workspace today/history feed, and make `studio.task.list` return at most 200 compact task summaries per call. Preserve Dashboard, Task Board, mobile, CLI, legacy HTTP, and Writer Worker behavior.

## Task 1: Paged Task Query Contract

**Files:**
- Modify: `src/ports/query-port.ts`
- Modify: `src/store/tasks.ts`
- Modify: `src/queries/task-list-query.ts`
- Modify: `src/data-worker/query-worker/operations.ts`
- Modify: `src/queries/worker-query-port.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Modify: `src/gateway/http/query-routes.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/unit/task-page-query.test.ts`
- Test: `tests/integration/query-transport-parity.test.ts`

Steps:
1. Write failing tests for deterministic `created_at DESC, id DESC` pagination, task-ID cursors, today/history boundaries, terminal-status exclusion, totals, invalid cursor handling, and page-only enrichment.
2. Run the focused tests and confirm failures are caused by the missing page API.
3. Add `TaskPageQuery` and `TaskPage` types without changing `TaskListQuery` or `listTasks()`.
4. Implement a parameterized paged task-row query and resolve cursors within the current project scope.
5. Enrich only returned page IDs and expose the operation through Query Worker, HTTP, and RPC as `tasks.page`.
6. Add matching indexes through the repository's existing schema/index initialization pattern.
7. Run focused query tests until green.

## Task 2: Studio AI Task List

**Files:**
- Modify: `src/tools/handlers/studio-task-crud-tools.ts`
- Modify: `src/tools/seed.ts`
- Modify: `src/core/master-prompt.ts`
- Test: `tests/unit/studio-task-crud-tools.test.ts` or the closest existing tool test
- Test: `tests/unit/tool-seed.test.ts`

Steps:
1. Write failing tests for default 200, maximum 200, compact fields, `query`, simple task-ID cursor, `hasMore`, `nextCursor`, `total`, and context-injected project scope.
2. Confirm the current full-array handler fails the new contract.
3. Reuse the paged task-row query in `studio.task.list`; do not expose `projectId` after runtime schema sanitization.
4. Update the seeded schema and tool description with `status`, `query`, `limit`, and `cursor`.
5. Update the master prompt: use `query` first and only request another page when the target is absent and `hasMore` is true.
6. Keep `core.task.list` unchanged for compatibility.
7. Run focused tool tests until green.

## Task 3: Workspace Today And History Feeds

**Files:**
- Modify: `ui/src/services/query-client.ts`
- Modify: `ui/src/stores/task.store.ts`
- Add: `ui/src/pages/workspace/task-collab/use-workspace-task-pages.ts`
- Modify: `ui/src/pages/workspace/task-collab/TaskPanel.tsx`
- Modify: `ui/src/pages/workspace/task-collab/TaskList.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/workspace-task-pages.test.tsx`
- Test: `tests/unit/task-project-cache.test.ts`

Steps:
1. Write failing store/hook tests for independent project/tab/filter pages, 50-item requests, append-by-ID, scroll continuation, reload-first-page merge, and stale request rejection.
2. Add a paged query client method and Workspace-only page state; do not overload the existing complete-list cache.
3. Query today with `createdFrom` and history with `createdBefore` using the local start-of-day ISO boundary.
4. Add an intersection sentinel to `TaskList`; history scrolling requests `nextCursor` once and preserves scroll position.
5. Use server totals for tab badges and server-side terminal exclusion for the checkbox.
6. Keep task details on `tasks.get`; after task mutations refresh the first matching page without dropping already loaded history.
7. Run focused UI tests until green.

## Task 4: Route Compatibility And Recovery

**Files:**
- Modify: `ui/src/project-scope/project-data-scope.ts`
- Modify: `ui/src/pages/TaskBoard.tsx`
- Modify: `ui/src/app-runtime-bootstrap.ts` only if task recovery needs explicit invalidation
- Test: `tests/unit/project-data-scope.test.ts`
- Test: `tests/unit/task-project-cache.test.ts`

Steps:
1. Write failing tests proving project activation no longer eagerly fetches the full task list and Task Board explicitly requests it on entry.
2. Remove the eager full task fetch from shared project refresh while retaining `activateProject()` cache scoping.
3. Make Task Board load the existing complete list on entry/reconnect and render a loading state before treating counts as complete.
4. Ensure reconnect invalidates or refreshes mounted Workspace pages without clearing visible history.
5. Confirm Dashboard remains unchanged because it already calls `fetchTasks()` explicitly.

## Task 5: Documentation, Review, And Integration

**Files:**
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `README.md` only if the user-visible Workspace behavior is documented there

Steps:
1. Document `tasks.page`, its filters, result envelope, cursor behavior, defaults, and compatibility with `tasks.list`.
2. Run focused tests after each implementation slice.
3. Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check` from the feature worktree.
4. Review every changed file for contract compatibility, project isolation, stale requests, reconnect behavior, cursor deletion, and 400-line/300-line limits.
5. Commit the reviewed changes on `feat/workspace-task-pagination`.
6. Merge into `prd` with `--no-ff` from the main repository without restarting PRD.
7. Re-run required verification on the merged branch and report commit IDs and exact results.

## Non-Goals

- No Writer Worker changes.
- No change to task mutations or task schemas.
- No pagination migration for Dashboard, Task Board, mobile, CLI, or legacy callers.
- No removal of `core.task.list`.
