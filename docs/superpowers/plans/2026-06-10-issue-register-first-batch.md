# Issue Register First Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the first batch of clear issues from the DingTalk AI IDE Studio issue register.

**Architecture:** Keep each issue as a small, independently testable change with its own commit. Prefer existing stores, RPC handlers, and event bus boundaries instead of adding broad abstractions.

**Tech Stack:** TypeScript, Hono Gateway RPC handlers, mitt events, better-sqlite3 stores, React/Zustand frontend, Vitest.

---

### Task 1: ISSUE-009 Task Update Broadcast

**Files:**
- Modify: `src/gateway/rpc/tasks.ts`
- Test: `tests/unit/task-rpc.test.ts`

- [ ] Write a failing test that calls `tasks.update` with only status/stage and asserts one `task:update` event.
- [ ] Run the focused test and verify it fails with two events.
- [ ] Change `tasks.update` so the status/stage path relies on `taskManager.updateTask`'s existing broadcast and does not emit again.
- [ ] Run the focused test and commit only this issue.

### Task 2: ISSUE-012 Sensitive File Reads

**Files:**
- Modify: `src/core/filesystem.ts`
- Test: `tests/unit/filesystem.test.ts`

- [ ] Write failing tests showing `.env`, `.env.local`, and hidden dotfiles cannot be read by known path while `.env.example` remains readable.
- [ ] Run the focused test and verify sensitive reads currently succeed.
- [ ] Reuse the same ignore semantics in `readFile` that the file tree uses.
- [ ] Run the focused test and commit only this issue.

### Task 3: ISSUE-011 Dashboard Project Scope

**Files:**
- Modify: `ui/src/pages/Dashboard.tsx`
- Create: `ui/src/pages/dashboard-scope.ts`
- Test: `tests/unit/dashboard-scope.test.ts`

- [ ] Write a failing pure helper test proving agents, sessions, and tasks are scoped to the active project.
- [ ] Run the focused test and verify the helper does not exist yet.
- [ ] Add a small dashboard scope helper and use it in Dashboard stats, lists, and task modal agent options.
- [ ] Run the focused test and commit only this issue.

### Task 4: ISSUE-008 Team Task Global Broadcast

**Files:**
- Modify: `src/core/teams.ts`
- Test: `tests/unit/team-tool-handlers.test.ts`

- [ ] Write failing tests that `teamService.createTask` and `teamService.updateTask` emit global `task:update`.
- [ ] Run the focused tests and verify no global task event is emitted.
- [ ] Emit `task:update` beside the existing `team:update` for Team task create/update.
- [ ] Run the focused tests and commit only this issue.

### Task 5: ISSUE-004 / ISSUE-007 Task Assignment Session Validation

**Files:**
- Modify: `src/core/tasks.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Test: `tests/unit/task-rpc.test.ts`

- [ ] Write failing tests for reusing a session from another agent/project and for failed assignment not persisting `assigned_agent_id`.
- [ ] Run the focused tests and verify current behavior accepts the wrong session or leaves stale assignment.
- [ ] Add a focused session reuse validation helper and validate before assigning.
- [ ] Run focused tests and commit only this issue.

### Final Verification

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Review all issue commits and cherry-pick them to the prd worktree.
