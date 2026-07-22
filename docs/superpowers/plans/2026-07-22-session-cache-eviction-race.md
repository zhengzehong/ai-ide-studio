# Session Cache Eviction Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a project whose Session cache was evicted during an in-flight refresh from remaining falsely empty when the user returns.

**Architecture:** Treat LRU eviction as payload eviction, not request invalidation: keep the lightweight per-scope request sequence so an already-running response can still commit. Keep explicit project cleanup unchanged so deleted projects still invalidate late responses. When a cache-miss reuses an existing Session request, expose the existing loading state until it settles.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest

---

### Task 1: Preserve in-flight request validity across LRU eviction

**Files:**
- Modify: `ui/src/stores/project-cache.ts`
- Test: `tests/unit/project-cache.test.ts`

- [x] Add a failing test that starts a request, evicts its populated scope through `pruneProjectCache`, and verifies the response can still commit.
- [x] Run `npx vitest run tests/unit/project-cache.test.ts` and confirm the regression test fails because the request sequence is deleted.
- [x] Add a payload-only eviction helper and use it from `pruneProjectCache`; retain `clearProjectCache` for explicit invalidation.
- [x] Re-run the unit test and confirm it passes.

### Task 2: Show loading while reusing an in-flight Session request

**Files:**
- Modify: `ui/src/project-scope/project-data-scope.ts`
- Modify: `ui/src/stores/session.store.ts`
- Test: `tests/unit/project-data-scope.test.ts`
- Test: `tests/unit/session-project-cache.test.ts`

- [x] Add a failing store test that reproduces A refresh, five-project eviction, and A reactivation while the original request is unresolved.
- [x] Verify the test fails with a false empty Session state.
- [x] Set the active cache-miss scope to loading while it awaits the valid in-flight request.
- [x] Recheck the Session store when project-level activation coalescing would otherwise skip a cache-miss refresh.
- [x] Verify the Session list is restored and loading clears after the response.

### Task 3: Verify and review

**Files:**
- Verify all modified files and documentation.

- [x] Run targeted tests.
- [x] Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `npm test`.
- [ ] Run `git diff --check`, commit the branch, and request code review before any PRD merge.
