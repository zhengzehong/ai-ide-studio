# Copy Session Latest History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a copy-session action that forks the underlying ACP runtime and duplicates only the latest 10 persisted chat messages plus their related events.

**Architecture:** The backend exposes a new `sessions.copy` RPC implemented in `sessionManager.copySession`. Runtime context is copied through ACP `session/fork`; local UI history is copied separately by a focused store helper that remaps message ids and event references for only the latest 10 messages. The frontend adds a session menu action that calls the new RPC, selects the copied session, and loads its copied history.

**Tech Stack:** Hono/ws backend, SQLite via better-sqlite3, ACP SDK, React/Zustand frontend, Vitest integration/unit tests, patch-package for `@agentclientprotocol/codex-acp`.

---

### Task 1: Backend Copy Semantics

**Files:**
- Modify: `src/store/sessions.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/integration/ws-copy-session.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/ws-copy-session.test.ts` with a test that creates a source session, appends 12 messages and matching events, stubs `acpHost.forkSession`, calls `sessions.copy`, and asserts the copy has exactly the latest 10 messages with new ids/session ids and related events only.

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/integration/ws-copy-session.test.ts`
Expected: fail because `sessions.copy` is not registered.

- [ ] **Step 3: Add store helper**

Add `messageStore.copyLatestWithEvents(sourceSessionId, targetSessionId, limit)` that:
- selects latest messages by timestamp descending, reverses them to chronological order;
- creates new message ids and inserts full message rows with original content/tool JSON/attachments/file change JSON;
- copies events whose `message_id` is one of the copied messages, or whose `payload_json.messageId` matches one of them;
- remaps `message_id` and top-level `payload_json.messageId`;
- starts copied event `sequence` at 1.

- [ ] **Step 4: Add session manager method**

Add `sessionManager.copySession(sourceSessionId, opts)` that creates the target local session, forks runtime, updates the copied ACP id, copies latest 10 messages/events, emits `session:changed`, and closes/soft-deletes the target on runtime copy failure.

- [ ] **Step 5: Add RPC and protocol type**

Register `sessions.copy` in `src/gateway/rpc/sessions.ts`; add `SessionsCopyMsg` in `src/types/ws-protocol.ts`.

- [ ] **Step 6: Run integration test**

Run: `npm test -- tests/integration/ws-copy-session.test.ts`
Expected: pass.

### Task 2: Codex ACP Fork Patch

**Files:**
- Modify: `node_modules/@agentclientprotocol/codex-acp/dist/index.js`
- Modify: `patches/@agentclientprotocol+codex-acp+0.0.44.patch`

- [ ] **Step 1: Patch dist bundle**

Add Codex ACP fork support by exposing `sessionCapabilities.fork`, adding `threadFork`, and implementing ACP `unstable_forkSession` through Codex app-server `thread/fork`.

- [ ] **Step 2: Refresh patch-package file**

Run: `npx patch-package @agentclientprotocol/codex-acp`
Expected: patch file updates cleanly and still includes the previous system-prompt injection changes.

### Task 3: Frontend Action

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [ ] **Step 1: Add store action**

Add `copySession(sessionId)` that calls `sessions.copy`, adds the returned session to the scoped list, and returns it.

- [ ] **Step 2: Add session menu item**

Add a Chinese `复制` menu item that calls `copySession`, closes the menu, selects the new session, and fetches its messages/events.

### Task 4: Verification And Commit

**Files:**
- Verify changed files only plus relevant test suites.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/integration/ws-copy-session.test.ts tests/integration/ws-fork.test.ts`
Expected: pass.

- [ ] **Step 2: Run broader verification**

Run: `npm test`
Run: `npm run build`
Run: `npm run lint`
Expected: all pass or only pre-existing unrelated failures are reported with evidence.

- [ ] **Step 3: Review diff and commit**

Run: `git diff --check`
Run: `git status --short`
Stage only files changed for this feature and commit with message `feat: copy sessions with recent history`.
