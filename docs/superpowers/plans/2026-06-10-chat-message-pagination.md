# Chat Message Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load only the latest 20 chat messages on session open and fetch older messages when the user scrolls upward.

**Architecture:** Keep the existing backend `sessions.messages` API because it already supports `limit` and `before`. Add frontend session-store pagination state and a `loadOlderMessages()` action, then trigger it from the chat scroll container while preserving scroll position after prepending older messages.

**Tech Stack:** React 19, Zustand session store, existing WS RPC, Vitest.

---

### Task 1: Store Pagination State

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [x] Add tests that initial `fetchMessages(sessionId)` sends `limit: 20`.
- [x] Add tests that `loadOlderMessages(sessionId)` sends `before` using the oldest loaded message timestamp.
- [x] Add tests that `loadOlderMessages(sessionId)` stops requesting after a short page marks no more messages.
- [x] Implement `CHAT_MESSAGE_PAGE_SIZE = 20`, `hasMoreMessagesBySession`, `loadingOlderMessagesBySession`, and `loadOlderMessages()`.
- [x] Keep pagination state keyed by session so switching away and back preserves any older pages already loaded in this frontend run.

### Task 2: Workspace Scroll Trigger

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Read `hasMoreMessagesBySession`, `loadingOlderMessagesBySession`, and `loadOlderMessages` from the store.
- [x] Trigger older-message loading when the chat scroll container is within 120px of the top.
- [x] Preserve scroll position by comparing `scrollHeight` before and after the older page is prepended.
- [x] Avoid auto-scrolling to bottom while an older page is being prepended.

### Task 3: Verification And Sync

**Files:**
- Review all changed files.

- [x] Run targeted session-store pagination tests.
- [x] Run `npm run lint`, `npm run build`, and `npm test`.
- [ ] Commit the current branch.
- [ ] Cherry-pick or otherwise update the `prd` branch/worktree with the commit.
