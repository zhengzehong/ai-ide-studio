# Task Collaboration Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align task collaboration tools with the B+ selfExecute decision, complete step management UI, and remove the old task detail drawer path.

**Architecture:** `studio.task.create` becomes a collaboration container by default and creates a default step only for `selfExecute=true`. Existing step stores/managers remain the step graph boundary; frontend task details use `TaskDetailInline` and a shared task creation modal.

**Tech Stack:** Hono backend, SQLite stores, MCP tool handlers, Vite React 19, Zustand, Vitest.

---

### Task 1: Backend create semantics

**Files:**
- Modify: `src/store/tasks.ts`
- Modify: `src/core/tasks.ts`
- Modify: `src/tools/handlers/studio-task-crud-tools.ts`
- Modify: `src/tools/seed.ts`
- Test: `tests/unit/task-steps-collab.test.ts`
- Test: `tests/unit/tool-seed.test.ts`

- [x] **Step 1: Add failing tests for `studio.task.create` B+ behavior**

Add tests asserting:
- `selfExecute=true` requires context agent/session, creates exactly one default step, sets task running, links current session, returns `defaultStepId`, and does not enqueue a prompt.
- `selfExecute=false` creates a draft task with no assigned agent, no session, and no steps.

Run: `npx vitest run tests/unit/task-steps-collab.test.ts`
Expected: FAIL until backend logic changes.

- [x] **Step 2: Add failing seed schema assertions**

Update `tests/unit/tool-seed.test.ts` to assert `studio.task.create` schema properties are only `title`, `description`, `selfExecute`, `projectId`, with required `title` and `description`; assert `studio.task.createSimple` requires `description`.

Run: `npx vitest run tests/unit/tool-seed.test.ts`
Expected: FAIL until seed schema changes.

- [x] **Step 3: Clean `CreateTaskInput`**

Remove create-time dispatch fields from `CreateTaskInput`: `assignAgentId`, `sessionMode`, `sessionId`, `executionModeId`, `promptTemplate`, `ruleName`, `images`. Keep `title`, required `description`, `source`, `projectId`, `selfExecute`, plus existing metadata fields still used by non-tool callers (`teamId`, `assigneeMemberId`, `ruleId`).

- [x] **Step 4: Rewrite `taskManager.createTask`**

Validate title and description. For `selfExecute=true`, require current agent/session, create the task, create a default step assigned to that agent/session, set task running, mark the step running because the current Agent is already executing, link the session, emit lifecycle/update events, and return the updated task with `sessionId` and `defaultStepId`.

For `selfExecute=false`, create only the draft task and emit created events. Do not dispatch prompt, save images, assign agent, resolve session, or read execution mode.

- [x] **Step 5: Update task create handlers and seed**

Make `studio.task.create` parse only `title`, `description`, `selfExecute`, and `projectId`. Pass current context agent/session only when `selfExecute=true`. Make `studio.task.createSimple` require `description` in handler and seed schema.

- [x] **Step 6: Preserve old assignment callers explicitly**

Update WS RPC, legacy `core.task.create`/`create_task`, and scheduled task creation so callers needing dispatch use `taskManager.assignTask` after creating the task. Ensure event conversion remains a draft task with a required fallback description.

- [x] **Step 7: Run backend focused verification**

Run:
- `npx vitest run tests/unit/task-steps-collab.test.ts`
- `npx vitest run tests/unit/task-rpc.test.ts tests/unit/task-image-attachments.test.ts`
- `npx vitest run tests/unit/tool-seed.test.ts tests/unit/core-tool-handlers.test.ts`

Expected: relevant backend tests pass; note any pre-existing unrelated failures separately.

### Task 2: Prompt and design document alignment

**Files:**
- Modify: `src/core/ai-ide-system-prompt.ts`
- Modify: `src/core/master-prompt.ts`
- Modify: `docs/design/task-collaboration-tools.md`

- [x] **Step 1: Update prompts**

Remove every `acceptanceCriteria` mention. Update system prompt so `selfExecute=true` says it creates a default step, skips prompt injection, enters running, and future reports must include `stepId` from `defaultStepId`.

- [x] **Step 2: Update design doc**

Add `selfExecute` to `task.create`, add scenario 2.5 for conversation tasking, and update the compatibility table. Do not modify `docs/design/task-collaboration-refactor-plan.md`.

- [x] **Step 3: Verify text**

Run:
- `rg -n "acceptanceCriteria|assignAgentId.*acceptanceCriteria" src/core`
- `rg -n "selfExecute" docs/design/task-collaboration-tools.md src/core/ai-ide-system-prompt.ts src/core/master-prompt.ts`

Expected: no `acceptanceCriteria` in prompts; `selfExecute` documented in the required files.

### Task 3: Step management UI

**Files:**
- Create: `ui/src/pages/workspace/task-collab/StepModal.tsx`
- Modify: `ui/src/pages/workspace/task-collab/TaskDetailInline.tsx`
- Modify: `ui/src/pages/workspace/task-collab/StepList.tsx`
- Modify: `ui/src/stores/task.store.ts`

- [x] **Step 1: Create `StepModal`**

Implement required title/description fields, optional assignee select, dependency multi-select from current task steps, and create/update submission using existing store methods. On success, show the draft notice text and close the modal.

- [x] **Step 2: Wire add/edit in detail**

Add local modal state in `TaskDetailInline`, pass `onAddStep` to `DetailActions`, pass `onSelectStep` to `StepList`, and refresh steps after add/update.

- [x] **Step 3: Add delete action in `StepList`**

Add a `Trash2` icon button per row, stop row-click propagation, confirm deletion, call `removeStep(taskId, stepId)`, and surface the draft notice.

### Task 4: Create task modal and drawer cleanup

**Files:**
- Create: `ui/src/pages/workspace/task-collab/CreateTaskModal.tsx`
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/pages/TaskBoard.tsx`
- Modify: `ui/src/pages/dashboard/ContextPanel.tsx`
- Delete or deprecate: `ui/src/components/tasks/TaskDetailDrawer.tsx`

- [x] **Step 1: Split create APIs in the store**

Keep a collaboration `createTask` path that sends only title/description/projectId. Add `createSimpleTask` for title/description/assignee/session/projectId and route it to a new `tasks.createSimple` RPC.

- [x] **Step 2: Add shared `CreateTaskModal`**

Provide mode selection for "协作任务" and "简单任务". Collaboration mode requires title/description and creates a draft container. Simple mode requires title/description/assignee and dispatches immediately. Do not expose conversation tasking.

- [x] **Step 3: Replace Workspace and TaskBoard creation modals**

Use the shared modal from both entry points. Remove the Workspace inline modal console error. Remove the TaskBoard local create modal.

- [x] **Step 4: Replace old task detail drawer**

Use `TaskDetailInline` in Dashboard context and TaskBoard detail. Remove the TaskBoard local drawer function. Delete or leave a deprecated shell for `TaskDetailDrawer.tsx`, and verify no imports remain.

### Task 5: Final verification and handoff

**Files:**
- Review all changed files.

- [x] **Step 1: File size and static checks**

Run:
- changed-file line count check
- `rg -n "console\\.|\\bany\\b" src ui/src`

- [x] **Step 2: Required commands**

Run:
- `npm run build`
- `npx tsc --noEmit`
- `npx vitest run`
- `npm run lint`
- `git diff --check`

- [ ] **Step 3: Commit and notify**

Commit on `worktree-task-collab-refactor`. Send formal code-review event (`categoryId=formal.code.merge`) and send PM message to `sess-58b02e18` with summary and commit hash.
