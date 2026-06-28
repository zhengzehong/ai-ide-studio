# Mobile Chat Rendering Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the mobile app chat rendering and process-item state updates with the PC workspace so the same turn cannot appear as both a persisted message and a streaming bubble.

**Architecture:** Reuse the existing PC `buildChatRenderItems` helper from mobile instead of duplicating render-list rules. Keep mobile-specific UI components, but move message/streaming reconciliation and process lazy loading into mobile store/page glue.

**Tech Stack:** React 19, Vite mobile workspace, Zustand, Vitest.

---

### Task 1: Add Regression Tests

**Files:**
- Modify: `tests/unit/chat-render-items.test.ts`
- Create: `tests/unit/mobile-chat-store.test.ts`

- [x] **Step 1: Add render de-duplication test**

Add a unit test proving a persisted message and streaming bubble with the same `id` produce one visible streaming item, while different IDs remain separate.

- [x] **Step 2: Add mobile process-item store test**

Mock `@desktop/services/ws-client`, load `mobile/src/stores/chat.store.ts`, register listeners, emit `session:process_item`, and assert the matching persisted message gets `processBlocks`.

- [x] **Step 3: Run tests and verify RED**

Run: `npx vitest run tests/unit/chat-render-items.test.ts tests/unit/mobile-chat-store.test.ts`

Expected: mobile process-item test fails because current store only updates `streamingMessage`.

### Task 2: Fix Mobile Render List

**Files:**
- Modify: `mobile/src/pages/ChatPage.tsx`
- Modify: `mobile/tsconfig.app.json`

- [x] **Step 1: Import `buildChatRenderItems`**

Use `@desktop/components/chat/render-items` from `ChatPage`.

- [x] **Step 2: Render `chatItems` instead of raw messages plus streaming**

Compute `chatItems` from `messages`, `events`, `streamingMessage`, and blocking state. Render `message` and `streaming` item kinds, with a lightweight `group` fallback for the short window before persisted messages load.

- [x] **Step 3: Include the desktop helper in mobile TypeScript scope**

Add `../ui/src/components/chat/render-items.ts` to `mobile/tsconfig.app.json` include list.

### Task 3: Fix Mobile Process State

**Files:**
- Modify: `mobile/src/stores/chat.store.ts`
- Modify: `mobile/src/components/chat/TurnContent.tsx`
- Modify: `mobile/src/pages/ChatPage.tsx`

- [x] **Step 1: Add `fetchMessageProcess` to mobile store**

Implement a minimal PC-parity loader that calls `sessions.messageProcess`, merges `processBlocks` and `finalAnswer` into the matching message, and updates `streamingMessage` only for running messages.

- [x] **Step 2: Merge realtime process items into persisted messages**

Update `session:process_item` listener to merge the process block into `messages[]` for the same `message_id`.

- [x] **Step 3: Trigger completed message process loading from `TurnContent`**

For completed agent messages with `process_item_count` or `tool_call_count` but no `processBlocks`, show the process section and load on expand.

### Task 4: Verify and Commit

**Files:**
- Review all changed files with `git diff`

- [x] **Step 1: Run targeted tests**

Run: `npx vitest run tests/unit/chat-render-items.test.ts tests/unit/mobile-chat-store.test.ts`

- [x] **Step 2: Run project verification**

Run: `npm run lint`, `npm run build`, `npm test`.

- [x] **Step 3: Review diff and commit**

Commit only the relevant files. Leave unrelated Excel files untouched.
