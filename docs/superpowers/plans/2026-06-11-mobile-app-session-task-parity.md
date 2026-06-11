# Mobile App Session And Task Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the mobile app session list, chat running-state recovery, unread indicators, and task list behavior with the PC app while preserving the existing widget notification behavior.

**Architecture:** Mobile should use `sessions.list` as the main conversation source, with local `runningSessionIds` and `unreadSessionIds` indicator maps like the PC sidebar. Widget read state remains widget-only. Chat should avoid rendering the same running agent turn twice and should derive elapsed time from persisted message timestamps when the mobile page re-enters an already-running session. Tasks should respect the selected project and consume `task:update` events.

**Tech Stack:** React 19, Zustand 5, TypeScript 6, Vite 8, Vitest, shared PC helpers from `ui/src/stores/session-events` and `ui/src/stores/turn-blocks`.

---

### Task 1: Mobile Session List Uses PC-Style Sessions

**Files:**
- Modify: `mobile/src/stores/session.store.ts`
- Modify: `mobile/src/components/SessionCard.tsx`
- Modify: `mobile/src/pages/SessionListPage.tsx`
- Modify: `mobile/src/pages/ChatPage.tsx`
- Modify: `mobile/src/utils/session-indicator.ts`
- Test: `tests/unit/mobile-session-store.test.ts`

- [x] **Step 1: Write failing tests for session source and local indicators**

Update `tests/unit/mobile-session-store.test.ts` to expect:
- `fetchSessions('project-a')` calls `{ type: 'sessions.list', projectId: 'project-a' }`.
- fetched sessions are retained after `markRead(sessionId)`; `markRead` does not call `widget.sessions.markRead`.
- `session:activity` running adds the session to `runningSessionIds`, idle clears running and marks unread only when it is not the current viewed session.
- entering a session clears local unread without hiding the session.

- [x] **Step 2: Run the targeted session test and confirm RED**

Run: `npx vitest run tests/unit/mobile-session-store.test.ts`

Expected: fail because current mobile store still calls `widget.sessions.list` and `widget.sessions.markRead`.

- [x] **Step 3: Replace mobile session data model**

In `mobile/src/stores/session.store.ts`:
- import `SessionData` from `@desktop/stores/session.store`.
- define a mobile view model with `id`, `agentId`, `agentName`, `projectId`, `sessionTitle`, `status`, `activityState`, `stage`, `startedAt`, `updatedAt`, `lastMessageAt`, `unread`.
- fetch via `sessions.list`.
- map backend snake_case fields into mobile camelCase fields.
- add `runningSessionIds`, `unreadSessionIds`, and `currentSessionId`.
- make `markRead` local-only and keep the session in the list.

- [x] **Step 4: Update list and card consumers**

In `SessionCard` and `SessionListPage`, switch from `session.sessionId` to `session.id` and from widget unread to local indicator state. Ensure agent filtering still uses `agentId`.

- [x] **Step 5: Update chat entry read clearing**

In `ChatPage`, replace widget read behavior with local read clearing, and ensure header lookup uses `session.id`.

- [x] **Step 6: Run targeted session tests and build slice**

Run:
- `npx vitest run tests/unit/mobile-session-store.test.ts`
- `npm run build:mobile`

Expected: both pass.

### Task 2: Mobile Chat Running Turn Recovery

**Files:**
- Modify: `mobile/src/stores/chat.store.ts`
- Modify: `mobile/src/pages/ChatPage.tsx`
- Test: `tests/unit/mobile-chat-store.test.ts`

- [x] **Step 1: Write failing tests for running message recovery**

Add tests in `tests/unit/mobile-chat-store.test.ts` that:
- `enterSession` with a running agent message produces a streaming bubble and `buildChatRenderItems` suppresses the duplicate persisted message.
- running recovery sets elapsed baseline from `started_at` or `timestamp` so `session:done` can write `elapsedSeconds`.

- [x] **Step 2: Run chat tests and confirm RED**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts`

Expected: fail on the missing elapsed baseline or duplicate-prevention behavior.

- [x] **Step 3: Implement running recovery**

In `mobile/src/stores/chat.store.ts`:
- set `promptStartTime` from `running.started_at` or `running.timestamp` when re-entering a running session.
- ensure the running message is represented by `streamingMessage` and not rendered as a second completed-looking persisted bubble.
- keep process loading behavior intact by still calling `fetchMessageProcess`.

- [x] **Step 4: Verify chat tests**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts`

Expected: pass.

### Task 3: Mobile Task List Project Scope And Realtime Updates

**Files:**
- Modify: `mobile/src/pages/TaskListPage.tsx`
- Test: `tests/unit/mobile-task-status.test.ts`

- [x] **Step 1: Write failing tests for task project filtering and updates**

Extend or add a mobile task list unit test to verify:
- fetching with `currentProjectId` sends `{ type: 'tasks.list', projectId }`.
- `task:update` merges created/updated tasks when they are in the active project.
- `task:update` removes deleted tasks.
- task events from other projects are ignored while a project filter is active.

- [x] **Step 2: Run task tests and confirm RED**

Run: `npx vitest run tests/unit/mobile-task-status.test.ts`

Expected: fail because `TaskListPage` currently fetches all tasks once and has no listener.

- [x] **Step 3: Implement task list project and realtime behavior**

In `TaskListPage`:
- read `currentProjectId` from `useAppStore`.
- pass projectId to `tasks.list`.
- refresh when `currentProjectId` changes.
- register `task:update` listener and merge/delete entries locally.
- avoid adding tasks from another project while scoped to a project.

- [x] **Step 4: Verify task tests**

Run: `npx vitest run tests/unit/mobile-task-status.test.ts`

Expected: pass.

### Task 4: Final Verification, Review, Commit, And PRD Update

**Files:**
- Modify: plan checkboxes in `docs/superpowers/plans/2026-06-11-mobile-app-session-task-parity.md`
- Review: all files changed in Tasks 1-3

- [x] **Step 1: Run focused verification**

Run:
- `npx vitest run tests/unit/mobile-session-store.test.ts tests/unit/mobile-chat-store.test.ts tests/unit/mobile-task-status.test.ts`
- `npm run build:mobile`
- `npm run lint -w mobile`

- [x] **Step 2: Run broader project checks**

Run:
- `npm run build`
- `npm run lint`
- `npm test`
- `git diff --check`

- [x] **Step 3: Perform code review**

Review the diff for:
- no widget behavior regression outside mobile.
- mobile session list no longer hides read idle sessions.
- running/unread indicators match PC priority.
- running chat turn is not duplicated.
- task list respects current project and task updates.
- no unrelated changes or Excel files staged.

- [ ] **Step 4: Commit on prd**

Run:
- `git status --short`
- `git add docs/superpowers/plans/2026-06-11-mobile-app-session-task-parity.md mobile/src tests/unit`
- `git commit -m "fix: align mobile sessions and tasks with pc behavior"`

- [ ] **Step 5: Update prd branch state**

Confirm `HEAD` is on `prd` and the new commit is present with:
- `git branch --show-current`
- `git log --oneline -1`
- `git status --short --branch`
