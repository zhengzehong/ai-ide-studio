# Agent Session Bulk Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact Agent-level menu in Workspace for marking all visible sessions read and selecting eligible sessions for batch deletion.

**Architecture:** Keep the existing Workspace and SessionBar flow. Add a small batch-action service behind one `sessions.bulkAction` RPC, with the server enforcing the current project/Agent scope and protected-session rules. The SessionBar owns selection-mode UI while the session store applies returned per-session results to its existing caches and indicators.

**Tech Stack:** React 19, TypeScript, Zustand, Hono/WebSocket RPC, better-sqlite3, Vitest.

**Spec:** User-approved compact Agent SessionBar design from the current conversation.

## Global Constraints

- Scope is the currently selected Agent in the current project; no new global management page.
- Preserve existing single-session delete/read actions and Agent/session sorting behavior.
- Primary, running, and currently selected sessions are not batch-deletable.
- No database migration; use existing session fields and soft-delete semantics.
- Do not modify the Workspace middle conversation pane, APP, SessionDock, or Widget.

---

### Task 1: Define the batch-action contract and failing tests

**Files:**
- Modify: `src/types/ws-protocol.ts`
- Modify: `ui/src/stores/session.store.ts`
- Create: `tests/unit/session-bulk-actions.test.ts`
- Create: `tests/unit/session-bar-bulk.test.tsx`

**Interfaces:**
- Produces `sessions.bulkAction` client/server message types and a typed per-session result.
- Produces store methods `bulkMarkAgentSessionsRead(agentId, projectId)` and `bulkDeleteSessions(sessionIds)`.

- [x] **Step 1: Write failing service/store contract tests**
  - Assert the action payload preserves `agentId`, `projectId`, `sessionIds`, and `action`.
  - Assert protected session IDs are reported as skipped with a reason.
  - Assert successful deletion removes sessions and indicators from the store.

- [x] **Step 2: Write failing SessionBar interaction tests**
  - Assert the three-dot menu opens.
  - Assert “批量标记已读” invokes the read action without entering selection mode.
  - Assert “选择会话删除” renders checkboxes and a delete toolbar.
  - Assert selecting an eligible row enables delete while protected rows remain disabled.

- [x] **Step 3: Run targeted tests and verify they fail for missing behavior**
  - Run `npx vitest run tests/unit/session-bulk-actions.test.ts tests/unit/session-bar-bulk.test.tsx`.

### Task 2: Implement server-side scoped batch actions

**Files:**
- Modify: `src/types/ws-protocol.ts`
- Create: `src/core/session-bulk-actions.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Create: `tests/unit/session-bulk-actions.test.ts`

**Interfaces:**
- `executeSessionBulkAction(input): Promise<SessionBulkActionResult>` validates scope and returns succeeded/skipped IDs.
- RPC `sessions.bulkAction` accepts `agentId`, `projectId`, `sessionIds`, and `action`.

- [x] **Step 1: Implement scoped candidate lookup and protection checks**
- [x] **Step 2: Implement mark-read action using one database transaction and session events**
- [x] **Step 3: Implement soft-delete action with existing session manager cleanup semantics and per-item result reporting**
- [x] **Step 4: Register the RPC with strict payload validation and a bounded ID list**
- [x] **Step 5: Run server targeted tests and confirm green**

### Task 3: Implement store and SessionBar UI

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/workspace/SessionBar.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/pages/workspace/session-drafts.ts` only if a shared confirmation helper is required
- Modify: `ui/src/pages/workspace/workspace.css` only if existing tokens need a small selection-mode rule

**Interfaces:**
- SessionBar receives `onBulkMarkRead` and `onBulkDelete` callbacks and the current `currentSessionId`, `runningSessionIds`, and session data already present in props.
- Store methods call `sessions.bulkAction`, update caches/indicators, and retain failed or skipped IDs for user feedback.

- [x] **Step 1: Implement store methods and result application**
- [x] **Step 2: Add three-dot menu beside the existing new-session control**
- [x] **Step 3: Add selection mode, disabled protected checkboxes, select-all, cancel, and confirmation dialog**
- [x] **Step 4: Disable sorting drag behavior while selection mode is active**
- [x] **Step 5: Run SessionBar and store tests and confirm green**

### Task 4: Verification, review, and commit

**Files:**
- Modify: tests only if verification exposes a missing contract.

- [x] **Step 1: Run targeted tests**
  - `npx vitest run tests/unit/session-bulk-actions.test.ts tests/unit/session-bar-bulk.test.tsx`
- [x] **Step 2: Run project checks**
  - `npm test`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- [x] **Step 3: Review the diff against this plan and verify unrelated files are untouched**
- [ ] **Step 4: Commit the worktree branch**
  - `git add src ui tests docs/superpowers/plans/2026-08-30-session-bulk-management.md`
  - `git commit -m "feat: add agent session bulk actions"`
