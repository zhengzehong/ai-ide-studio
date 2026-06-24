# Image Attachment Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat and task images under `DATA_DIR/images`, send them to ACP as image blocks, and append model-only file path notes without changing user-visible message text.

**Architecture:** Add a small backend attachment helper that writes images to scoped directories and builds hidden prompt notes. Chat prompts keep storing the user's original content while ACP receives the augmented prompt and image blocks. Task creation accepts images, persists them under the task, and passes the same hidden note plus image blocks when dispatching.

**Tech Stack:** TypeScript, Hono/ws RPC, better-sqlite3, React/Zustand, Vitest.

---

### Task 1: Backend Attachment Helper

**Files:**
- Create: `src/core/image-attachments.ts`
- Test: `tests/unit/image-attachments.test.ts`

- [x] Add tests for session/task path generation and hidden prompt formatting.
- [x] Implement image write/read helpers and prompt note builder.
- [x] Verify with `npm test -- tests/unit/image-attachments.test.ts`.

### Task 2: Chat Prompt Integration

**Files:**
- Modify: `src/core/sessions.ts`
- Test: `tests/unit/session-image-attachments.test.ts`

- [x] Add test proving stored human message content remains original while ACP prompt includes hidden attachment paths.
- [x] Save incoming chat images before persistence and send saved image blocks to ACP.
- [x] Verify with `npm test -- tests/unit/session-image-attachments.test.ts`.

### Task 3: Task Image Integration

**Files:**
- Modify: `src/store/tasks.ts`
- Modify: `src/core/tasks.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Modify: `src/store/migrations/index.ts`
- Create: `src/store/migrations/023-task-attachments.ts`
- Test: `tests/unit/task-image-attachments.test.ts`

- [x] Add a `task_attachments` migration and store helpers.
- [x] Accept `images` on `tasks.create`, persist them under the task directory, and dispatch them with hidden attachment notes.
- [x] Verify with `npm test -- tests/unit/task-image-attachments.test.ts tests/integration/sqlite-migration.test.ts`.

### Task 4: Frontend Task Image UI

**Files:**
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/pages/Dashboard.tsx`
- Modify: `ui/src/pages/TaskBoard.tsx`
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Add image upload/paste/drop support to task creation modals using the existing chat image shape.
- [x] Send images through `tasks.create`.
- [x] Verify with relevant unit tests or TypeScript build.

### Task 5: Review, Commit, Sync

- [x] Run targeted tests and `git diff --check`.
- [x] Review changed files for user-visible prompt leakage and unrelated edits.
- [ ] Commit on `dev`.
- [ ] Cherry-pick the commit to local `prd`.
