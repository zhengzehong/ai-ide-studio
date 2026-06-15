# Explicit Session Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow human and scheduled task assignment to explicitly reuse a selected existing Agent session.

**Architecture:** Keep the existing default of creating a new session when no session is selected. Persist explicit task-to-session execution links through `task_events`, because a reused session can carry multiple tasks over time and the current branch already has migration work in progress. Store scheduled rule targets in `action_config.session_id` and validate that the selected session belongs to the chosen Agent and project before execution.

**Tech Stack:** TypeScript, Hono RPC handlers, better-sqlite3 stores and migrations, React/Zustand front end, Vitest.

---

### Task 1: Persist Explicit Task Session Links

**Files:**
- Modify: `src/store/sessions.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Modify: `src/core/tasks.ts`
- Modify: `src/store/tasks.ts`
- Test: `tests/unit/task-rpc.test.ts`

- [ ] Add task event helpers to record and read task session links.
- [ ] Include linked sessions in `tasks.list` and `tasks.get`.
- [ ] Record a link whenever task creation or assignment reuses an existing session.
- [ ] Verify with unit tests that reused sessions remain visible after listing tasks.

### Task 2: Reuse Sessions From Scheduled Rules

**Files:**
- Modify: `src/core/rules.ts`
- Modify: `src/tools/handlers/schedule-tools.ts`
- Modify: `src/tools/handlers/create-schedule.ts`
- Test: `tests/unit/rules-session-reuse.test.ts`
- Test: `tests/unit/core-tool-handlers.test.ts`

- [ ] Pass `action_config.session_id` into scheduled `create_task`.
- [ ] Validate scheduled `send_prompt` session ownership before sending.
- [ ] Add `sessionId` to schedule creation and update tool schemas.
- [ ] Save tool `sessionId` as `action_config.session_id`.
- [ ] Verify rules and tools preserve explicit session targets.

### Task 3: Expose Session Reuse In UI Entrypoints

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/pages/Dashboard.tsx`
- Modify: `ui/src/pages/TaskBoard.tsx`
- Modify: `ui/src/pages/Schedule.tsx`
- Modify: `ui/src/types/index.ts`

- [ ] Add session selection to Workspace new task modal.
- [ ] Add session selection to Dashboard new task modal.
- [ ] Add session selection to TaskBoard detail assignment.
- [ ] Add session target selection to Schedule create/edit for both `create_task` and `send_prompt`.
- [ ] Filter selectable sessions by selected Agent and current project.

### Task 4: Verification And Integration

**Files:**
- Run existing tests and build checks.

- [ ] Run targeted unit tests for task/rule/tool behavior.
- [ ] Run `npm test`.
- [ ] Run `npm run lint` and `npm run build` if feasible.
- [ ] Review `git diff --check`.
- [ ] Commit only this feature's files.
- [ ] Cherry-pick or merge the commit to `prd`.
