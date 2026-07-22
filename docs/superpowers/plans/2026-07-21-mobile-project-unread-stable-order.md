# Mobile Project Unread And Stable Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile project unread/session counts come from a live all-project snapshot while keeping project and Agent positions stable when Session activity changes.

**Architecture:** Extend the existing `sessions.projectStats` read model with an active Session count, then add a mobile Zustand store that owns the complete project snapshot and refreshes it from realtime lifecycle events. Keep presentation ordering in pure mobile helpers: projects use creation order and Agent groups use the backend Agent order, while the existing per-Agent Session ordering remains unchanged.

**Tech Stack:** TypeScript, React 19, Zustand, Hono WebSocket RPC, better-sqlite3, Vitest.

---

### Task 1: Extend The Project Session Stats Snapshot

**Files:**
- Modify: `src/types/ws-protocol.ts`
- Modify: `src/store/session-stats.ts`
- Modify: `tests/integration/project-session-stats.test.ts`

- [x] Add failing integration assertions that every project snapshot includes `sessionCount`, excluding deleted, template, archived, and closed Sessions from that count.
- [x] Run `npx vitest run tests/integration/project-session-stats.test.ts` and confirm the new assertions fail because `sessionCount` is absent.
- [x] Add `sessionCount` to `ProjectSessionStatsData` and increment it for active, non-deleted, non-template Sessions in `projectSessionStatsStore.list`.
- [x] Re-run the integration test and confirm the RPC snapshot includes the count for projects with and without Sessions.

### Task 2: Add A Mobile All-Project Stats Store

**Files:**
- Create: `mobile/src/stores/project-session-stats.store.ts`
- Create: `tests/unit/mobile-project-session-stats-store.test.ts`
- Modify: `mobile/src/App.tsx`
- Modify: `tests/unit/mobile-app-bootstrap.test.ts`

- [x] Add failing unit tests for loading the complete `sessions.projectStats` snapshot, preserving the last successful snapshot on failure, and debouncing `session:activity`, `session:changed`, and `session:done` into one background refresh.
- [x] Add a failing bootstrap test proving mobile startup fetches project stats independently of the selected project Session list.
- [x] Run the targeted unit tests and confirm they fail because the mobile store and bootstrap integration do not exist.
- [x] Implement the Zustand store with request sequencing, loading/error state, 300 ms realtime debounce, and listener cleanup.
- [x] Register the store listener before realtime readiness and fetch its snapshot during `bootstrapMobileData`.
- [x] Re-run the targeted tests and confirm the background-project snapshot remains available while the selected project changes.

### Task 3: Stabilize Project And Agent Presentation Order

**Files:**
- Create: `mobile/src/pages/session-list-model.ts`
- Create: `tests/unit/mobile-session-list-model.test.ts`
- Modify: `mobile/src/stores/app.store.ts`
- Modify: `mobile/src/pages/SessionListPage.tsx`

- [x] Add failing pure-function tests proving projects sort by `created_at ASC, id ASC`, Agent groups preserve the backend Agent array order across unread/running changes, idle Agents remain visible, and unknown Agents append deterministically.
- [x] Run `npx vitest run tests/unit/mobile-session-list-model.test.ts` and confirm the missing model helpers fail.
- [x] Preserve `created_at` in `ProjectItem`, sort projects locally with the stable project helper, and build Agent groups from the fetched Agent list before attaching active Sessions.
- [x] Replace drawer counts derived from the current project Session array with the all-project stats snapshot.
- [x] Keep `SessionGroup` unchanged so Session ordering within each Agent continues to use its current unread/time behavior.
- [x] Re-run the model and store tests and confirm Agent/project positions do not change when activity data changes.

### Task 4: Verification And Delivery

**Files:**
- Modify only files already listed above if verification exposes a task-scoped defect.

- [x] Run targeted tests for mobile stats, list modeling, bootstrap, and backend project stats.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect the final diff for unrelated changes.
- [x] Commit on `fix/mobile-project-unread-stable-order` with a focused message; do not merge or restart `prd` without explicit instruction.
