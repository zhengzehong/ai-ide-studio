# Mobile Chat Pagination Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the mobile chat detail page to load messages in 10-item pages with in-memory session caching while preserving existing mobile chat behavior.

**Architecture:** Reuse the existing `sessions.messages` `limit` and `before` RPC fields, so no backend protocol change is needed. Add a mobile-only chat cache in `mobile/src/stores/chat.store.ts`, then wire `ChatPage` scroll handling to load older messages without disrupting current rendering, permissions, plans, streaming, or process loading.

**Tech Stack:** React 19, Zustand, Vite mobile app, Vitest.

---

### Task 1: Lock Store Paging And Cache Behavior

**Files:**
- Modify: `tests/unit/mobile-chat-store.test.ts`
- Modify: `mobile/src/stores/chat.store.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:
- `enterSession()` requests `sessions.messages` with `limit: 10`.
- `loadOlderMessages()` requests `limit: 10` and `before` the oldest loaded message.
- Leaving and re-entering a session restores cached messages before the refresh finishes.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts`

Expected: new tests fail because `loadOlderMessages` and cache fields are not implemented and `enterSession()` currently omits `limit`.

- [ ] **Step 3: Implement store changes**

In `mobile/src/stores/chat.store.ts`:
- Add `MOBILE_CHAT_MESSAGE_PAGE_SIZE = 10`.
- Add `hasMoreMessagesBySession`, `loadingOlderMessagesBySession`, and `loadOlderMessages`.
- Add a `sessionCaches` map and `saveCache()` helper.
- Restore cache on `enterSession()` before refreshing from the server.
- Save cache on `leaveSession()` and after successful message/event/process updates.
- Keep `sessions.events` at `limit: 500`.
- Change all detail refreshes to request `sessions.messages` with `limit: 10`.

- [ ] **Step 4: Run store tests**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts`

Expected: all tests in the file pass.

### Task 2: Wire Mobile Scroll Loading

**Files:**
- Modify: `mobile/src/pages/ChatPage.tsx`

- [ ] **Step 1: Add scroll state wiring**

Read `hasMoreMessagesBySession`, `loadingOlderMessagesBySession`, and `loadOlderMessages` from `useChatStore`.

- [ ] **Step 2: Add top-scroll loading**

When the chat scroller is near the top and the active session has more history, record `scrollHeight` and `scrollTop`, then call `loadOlderMessages(sessionId)`.

- [ ] **Step 3: Preserve scroll position**

After older messages merge, restore `scrollTop` by applying the `scrollHeight` delta. Existing first-load and streaming behavior should still scroll to the bottom unless the user is reading older history.

- [ ] **Step 4: Run mobile build**

Run: `npm run build:mobile`

Expected: TypeScript and Vite build pass.

### Task 3: Final Verification And Commit

**Files:**
- Review changed files only.

- [ ] **Step 1: Run targeted tests**

Run: `npx vitest run tests/unit/mobile-chat-store.test.ts tests/unit/mobile-turn-content-state.test.ts tests/unit/mobile-chat-elapsed.test.ts`

Expected: targeted tests pass.

- [ ] **Step 2: Run mobile build**

Run: `npm run build:mobile`

Expected: build passes.

- [ ] **Step 3: Inspect diff**

Run: `git diff --check` and `git diff --stat`.

Expected: no whitespace errors; diff only touches the planned files.

- [ ] **Step 4: Commit on local `prd`**

Run:
```powershell
git add docs/superpowers/plans/2026-06-16-mobile-chat-pagination-cache.md tests/unit/mobile-chat-store.test.ts mobile/src/stores/chat.store.ts mobile/src/pages/ChatPage.tsx
git commit -m "feat: paginate mobile chat history"
```

Expected: commit succeeds; unrelated local untracked files remain untracked.
