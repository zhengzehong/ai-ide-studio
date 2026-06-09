# Copy Session Empty Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change session copy/fork so the target session keeps ACP fork context but does not copy local chat history, and show copy progress/errors in the UI.

**Architecture:** Backend `sessionManager.copySession` still creates a target local session and calls ACP `forkSession`, but it no longer copies `messages`, `session_events`, or `turn_process_items`. The target session title is set to `Fork from <source title or id>`. Frontend `Workspace` tracks the session currently being copied, disables that menu action, shows `复制中...`, and surfaces backend errors.

**Tech Stack:** Hono/ws gateway, better-sqlite3 store, React/Zustand UI, Vitest tests.

---

### Task 1: Backend Copy Semantics

**Files:**
- Modify: `tests/integration/ws-copy-session.test.ts`
- Modify: `src/core/sessions.ts`

- [x] Update the copy integration test so `sessions.copy` asserts the copied session has:
  - a new local session id
  - a forked `acp_session_id`
  - title `Fork from <source title>`
  - zero copied messages
  - zero copied session events
  - zero copied process items
- [x] Run `npm test -- tests/integration/ws-copy-session.test.ts` and confirm the test fails because current code still copies local history.
- [x] Remove the `messageStore.copyLatestWithEvents(...)` call from `sessionManager.copySession`.
- [x] Set the copied session title to `Fork from ${source.title || source.id}`.
- [x] Keep existing fork cleanup on failure.
- [x] Run `npm test -- tests/integration/ws-copy-session.test.ts` and confirm it passes.

### Task 2: Runtime State Consistency

**Files:**
- Modify: `tests/unit/session-list-runtime-state.test.ts` or an existing focused session runtime state test
- Modify: `src/store/sessions.ts`
- Modify if needed: `src/core/sessions.ts`

- [x] Add a test showing a closed session with a running agent message is reported as `activity_state: 'running'`.
- [x] Add or adjust a test showing `sendPrompt` rejects closed/deleted sessions with a clear Chinese error.
- [x] Run the focused tests and confirm they fail on current behavior.
- [x] Update `resolveSessionRuntimeState()` to check active/running state before falling back to closed idle.
- [x] Update `sessionManager.sendPrompt()` to reject non-active sessions.
- [x] Run focused tests and confirm they pass.

### Task 3: Frontend Copy Feedback

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Add `copyingSessionId` local state.
- [x] Wrap `handleCopySession` in `try/catch/finally`.
- [x] While copying a session, disable that session menu copy button and show `复制中...`.
- [x] On backend error, show `window.alert(error.message || '复制会话失败')`.
- [x] On success, keep selecting the new session and loading its empty messages/events as existing flow already does.

### Task 4: Verification and Integration

**Files:**
- No extra source files unless tests require focused updates.

- [x] Run focused tests for copy/session state.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Review `git diff --check`.
- [ ] Commit only this task's tracked changes on the current branch.
- [ ] Cherry-pick or merge the commit to `D:\code_space\python_space\ai-ide-studio-prd`.
- [ ] Build/verify PRD branch without touching unrelated untracked Excel files.
