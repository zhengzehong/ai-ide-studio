# Mobile App Followup Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining mobile app state and connection issues found in review so APP behavior stays aligned with the PC app.

**Architecture:** Keep the mobile app on the existing shared WS client and Zustand stores. Preserve cross-project session indicators in the mobile session store, make connection state explicit in the mobile connection store, use a running-turn start timestamp for live elapsed time, and sequence app bootstrap so project/agent labels are available before session mapping.

**Tech Stack:** React 19, Zustand 5, TypeScript 6, Vite 8, Vitest.

---

### Task 1: Preserve Cross-Project Session Indicators

**Files:**
- Modify: `mobile/src/stores/session.store.ts`
- Test: `tests/unit/mobile-session-store.test.ts`

- [x] **Step 1: Add failing session indicator tests**

Add tests proving:
- fetching project A keeps an unread indicator for session B that is outside the returned scoped list.
- fetching a full all-project list prunes unread indicators for missing sessions.
- a running session returned by the scoped list clears unread for that same session.

- [x] **Step 2: Run session tests and confirm RED**

Run: `npx vitest run tests/unit/mobile-session-store.test.ts`

Expected: fail because `reconcileUnread()` currently prunes any unread session not returned by the current scoped fetch.

- [x] **Step 3: Implement scoped reconciliation**

In `mobile/src/stores/session.store.ts`:
- make unread reconciliation preserve out-of-scope indicators when `projectId` is set.
- make running reconciliation preserve out-of-scope running indicators when `projectId` is set.
- keep all-project fetch pruning behavior so truly missing sessions do not accumulate forever.

- [x] **Step 4: Verify session tests**

Run: `npx vitest run tests/unit/mobile-session-store.test.ts`

Expected: pass.

### Task 2: Make Mobile Connection Failure Explicit

**Files:**
- Modify: `mobile/src/stores/connection.store.ts`
- Modify: `mobile/src/App.tsx`
- Modify: `mobile/src/pages/ConnectPage.tsx`
- Modify: `mobile/src/pages/SettingsPage.tsx`
- Test: `tests/unit/mobile-connection-store.test.ts`

- [x] **Step 1: Add failing connection tests**

Add tests proving:
- saved server initialization enters `connecting` and calls `wsClient.connect`.
- a connection event sets status to `connected`.
- the connection timeout sets status to `failed` and leaves the app on the connect page.

- [x] **Step 2: Run connection tests and confirm RED**

Run: `npx vitest run tests/unit/mobile-connection-store.test.ts`

Expected: fail because connection status and route gating do not exist yet.

- [x] **Step 3: Implement explicit connection status**

In `mobile/src/stores/connection.store.ts`:
- add `status: 'idle' | 'connecting' | 'connected' | 'failed'`.
- add `lastError`.
- start a 5 second timeout on `init()` and `setServer()`.
- clear the timeout when connected.

In `mobile/src/App.tsx`:
- route to `ConnectPage` unless there is a saved server and status is `connected`.

In `ConnectPage` and `SettingsPage`:
- read the new status/error and display existing loading/error UI from store state.

- [x] **Step 4: Verify connection tests**

Run: `npx vitest run tests/unit/mobile-connection-store.test.ts`

Expected: pass.

### Task 3: Use Running Agent Start Time For Live Elapsed

**Files:**
- Modify: `mobile/src/stores/chat.store.ts`
- Modify: `mobile/src/pages/ChatPage.tsx`
- Modify: `mobile/src/utils/chat-elapsed.ts`
- Test: `tests/unit/mobile-chat-store.test.ts`
- Test: `tests/unit/mobile-chat-elapsed.test.ts`

- [x] **Step 1: Add failing elapsed tests**

Add tests proving:
- entering a session with a running agent message stores `runningStartedAtMs`.
- live elapsed seconds can be derived from `runningStartedAtMs` even when no human message is loaded.

- [x] **Step 2: Run chat elapsed tests and confirm RED**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts tests/unit/mobile-chat-elapsed.test.ts`

Expected: fail because the store does not expose `runningStartedAtMs` and live elapsed only uses human message timestamps.

- [x] **Step 3: Implement running elapsed state**

In `mobile/src/stores/chat.store.ts`:
- add `runningStartedAtMs: number | null`.
- set it from `running.started_at ?? running.timestamp` when recovering a running message.
- set it to `Date.now()` when sending a new prompt.
- clear it on leave, done, and idle.

In `mobile/src/utils/chat-elapsed.ts`:
- prefer `runningStartedAtMs` when provided.
- keep the human timestamp fallback.

In `ChatPage`:
- pass `runningStartedAtMs` to the elapsed helper.

- [x] **Step 4: Verify chat elapsed tests**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts tests/unit/mobile-chat-elapsed.test.ts`

Expected: pass.

### Task 4: Sequence Mobile Bootstrap Labels Before Sessions

**Files:**
- Modify: `mobile/src/App.tsx`
- Test: `tests/unit/mobile-app-bootstrap.test.ts`

- [x] **Step 1: Add failing bootstrap helper test**

Add a small exported bootstrap helper test proving projects and agents are awaited before `fetchSessions()`.

- [x] **Step 2: Run bootstrap test and confirm RED**

Run: `npx vitest run tests/unit/mobile-app-bootstrap.test.ts`

Expected: fail because `App` currently fires all three fetches without sequencing.

- [x] **Step 3: Implement sequenced bootstrap**

In `mobile/src/App.tsx`:
- export a helper `bootstrapMobileData()`.
- call `await Promise.all([fetchProjects(), fetchAgents()])`.
- then call `fetchSessions(currentProjectId)`.
- use the helper in the connected effect.

- [x] **Step 4: Verify bootstrap test**

Run: `npx vitest run tests/unit/mobile-app-bootstrap.test.ts`

Expected: pass.

### Task 5: Final Verification, Review, Commit, And PRD Update

**Files:**
- Modify: plan checkboxes in `docs/superpowers/plans/2026-06-12-mobile-app-followup-fixes.md`
- Review: all mobile files changed in Tasks 1-4

- [x] **Step 1: Run focused verification**

Run:
- `npx vitest run tests/unit/mobile-session-store.test.ts tests/unit/mobile-connection-store.test.ts tests/unit/mobile-chat-store.test.ts tests/unit/mobile-chat-elapsed.test.ts tests/unit/mobile-app-bootstrap.test.ts tests/unit/mobile-task-status.test.ts`
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
- no widget behavior regression.
- cross-project unread/running indicators are preserved.
- failed saved connection does not show an empty main app.
- live elapsed uses running agent start time.
- session labels are mapped after agents/projects load.
- no unrelated files or Excel files staged.

- [x] **Step 4: Commit on prd**

Run:
- `git status --short`
- `git add docs/superpowers/plans/2026-06-12-mobile-app-followup-fixes.md mobile/src tests/unit`
- `git commit -m "fix: improve mobile connection and session state"`

- [x] **Step 5: Confirm prd branch state**

Run:
- `git branch --show-current`
- `git log --oneline -1`
- `git status --short --branch`
