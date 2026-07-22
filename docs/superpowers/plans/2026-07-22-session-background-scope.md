# Session Background Scope Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent background Session refreshes for one project from replacing the visible Session state of another project.

**Architecture:** Keep visible scope ownership in `activateProject`; make `fetchSessions` a scoped cache fetch that updates visible state only when its scope is already active. Update the two non-Workspace callers that intentionally change visible scope to activate it explicitly.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest

---

### Task 1: Lock the inactive-project invariant with failing tests

**Files:**
- Modify: `tests/unit/session-project-cache.test.ts`

- [ ] Add a test that activates and loads project A, force-fetches project B without activating it, and asserts that A remains the active scope and visible Session list while B cache is populated.
- [ ] Add a test that rejects project B's background fetch and asserts that A's visible loading/error state remains unchanged while B receives a scoped cache error.
- [ ] Run `npx vitest run tests/unit/session-project-cache.test.ts` and verify both tests fail because the old implementation activates B.

### Task 2: Separate activation from fetching

**Files:**
- Modify: `ui/src/stores/session.store.ts:948-961`
- Modify: `ui/src/pages/Dashboard.tsx:69-77`
- Modify: `ui/src/pages/event-center/SubscriptionCreateModal.tsx:88-95`

- [ ] Remove the implicit `activeSessionScope` and visible `sessions` mutation from `fetchSessions`.
- [ ] Explicitly call `activateProject(null)` before Dashboard fetches the all-project Session list.
- [ ] Explicitly call `activateProject(projectId)` before the subscription form fetches its selectable Session list.
- [ ] Run `npx vitest run tests/unit/session-project-cache.test.ts` and verify the new tests and the existing eviction/reactivation test pass.

### Task 3: Verify and integrate

**Files:**
- Verify all modified files.

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `git diff --check` and inspect the final diff.
- [ ] Commit the fix, request independent code review, address blocking findings, and merge the reviewed branch into `prd` without restarting PRD.
