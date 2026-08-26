# Mobile Activity And Session Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile bottom-level pinned entry with a cross-project activity page and embed pinned sessions as a switchable mode inside the existing project-organized session page.

**Architecture:** Keep all server contracts and persistence unchanged. Add a mobile-only activity store/page around `widget.sessionActivity.list`, extract the existing pinned list body for embedding, and make the session view mode URL-addressable through `/?view=pinned` so chat navigation and legacy links preserve the selected mode.

**Tech Stack:** React 19, React Router, Zustand, TypeScript, Vitest, Capacitor Android.

---

### Task 1: Navigation and view-mode model

**Files:**
- Create: `mobile/src/pages/session-view-mode.ts`
- Test: `tests/unit/mobile-session-navigation.test.ts`

- [x] Write failing tests for parsing normal/pinned query modes, generating return URLs, the four bottom navigation entries, and the `/pinned` compatibility redirect.
- [x] Run `npx vitest run tests/unit/mobile-session-navigation.test.ts` and confirm the missing model/navigation behavior fails.
- [x] Implement the minimal URL helpers and route changes.
- [x] Run the focused test and confirm it passes.

### Task 2: Mobile activity data and page

**Files:**
- Create: `mobile/src/stores/activity.store.ts`
- Create: `mobile/src/pages/ActivityPage.tsx`
- Test: `tests/unit/mobile-activity-store.test.ts`
- Test: `tests/unit/mobile-activity-page.test.ts`

- [x] Write failing store tests for `widget.sessionActivity.list`, mark-read removal, running-session retention, event refresh, and reconnect refresh.
- [x] Run the focused tests and confirm they fail because the mobile activity modules do not exist.
- [x] Implement typed activity data, loading/error/empty states, grouped rows, navigation to chat, and existing RPC reuse.
- [x] Run the focused tests and confirm they pass.

### Task 3: Merge pinned sessions into the session page

**Files:**
- Modify: `mobile/src/pages/PinnedSessionsPage.tsx`
- Modify: `mobile/src/pages/SessionListPage.tsx`
- Create: `mobile/src/components/session-list/SessionListTopbar.tsx`
- Test: `tests/unit/pinned-sessions-ui.test.ts`
- Test: `tests/unit/mobile-session-navigation.test.ts`

- [x] Write failing tests for the embedded pinned list, the right-side mode toggle, preserved return URL, and disabled project drawer in pinned mode.
- [x] Run the focused tests and confirm the expected failures.
- [x] Extract the reusable pinned list, split the session top bar, and render normal/pinned content from the URL mode without changing the selected project.
- [x] Run the focused tests and confirm they pass.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/design/mobile-app.md`

- [x] Update mobile navigation, activity-query reuse, and session/pinned mode documentation.
- [x] Run focused mobile tests.
- [x] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
  - `npm test` completes all 359 files and 1827 assertions without a failed assertion, then reports the same 32 pre-existing asynchronous database-cleanup errors observed on the untouched `prd` baseline.
- [x] Review the final diff against every requirement and resolve all findings.
  - Independent review found one cross-project Agent metadata ordering issue; the final code now loads target-project Agents before Sessions, and the reviewer approved the correction with no remaining P0/P1/P2 findings.

### Task 5: Commit, merge, and Android package

- [ ] Commit the reviewed feature on `feat/mobile-activity-session-nav`.
- [ ] Merge the feature commit into `prd` without restarting services.
- [ ] Re-run the required verification on the merged `prd` tree.
- [ ] Run `npm run build:mobile:android:debug` and verify the APK exists and has a nonzero size.
- [ ] Present the APK and final delivery summary.
