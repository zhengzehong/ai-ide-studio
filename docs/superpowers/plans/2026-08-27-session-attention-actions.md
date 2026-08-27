# Session Attention Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable mark-unread plus direct pin/unread controls to desktop and a WeChat-style expandable action panel beside the mobile send button.

**Architecture:** Reuse the existing global Session Dock for pin state. Extend the shared Session command pipeline with `sessions.markUnread`, represented by a valid `last_read_at` timestamp immediately before `last_message_at`, then let each client leave the current Session only after the command succeeds.

**Tech Stack:** TypeScript, Hono WebSocket RPC, SQLite, React 19, Zustand, Vitest.

**Spec:** Approved in the current product discussion; no separate design document.

## Global Constraints

- Desktop action order is exactly: `分享`, `置顶/取消置顶`, `标记未读`, `时间线`.
- Mobile places a `+` button to the right of send/stop and expands exactly two actions below the composer.
- Marking unread succeeds before navigation; desktop clears only the Session selection, mobile returns to its source route.
- Pinning never navigates away from the current Session.
- No database migration, ACP change, task-system change, PRD restart, or live database access.

---

### Task 1: Durable Session mark-unread command

**Files:**
- Modify: `src/commands/session-command-types.ts`
- Modify: `src/commands/session-command-service.ts`
- Modify: `src/store/sessions.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `src/ports/write-data-port.ts`
- Modify: `src/commands/runtime-command-dispatcher.ts`
- Test: `tests/unit/session-command-types.test.ts`
- Test: `tests/integration/session-command-service.test.ts`

**Interfaces:**
- Consumes: existing `sessions.last_message_at` and `sessions.markRead` command pattern.
- Produces: `sessions.markUnread` returning `{ sessionId, lastReadAt }` and emitting `session:changed` with `event: 'marked_unread'`.

- [ ] **Step 1: Write failing contract and service tests**

Add assertions that the parser accepts `sessions.markUnread`, rejects unknown fields, marks a Session with messages unread, emits the canonical event, and rejects an empty Session.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/session-command-types.test.ts tests/integration/session-command-service.test.ts`

Expected: failures because `sessions.markUnread` is not in the command union or service switch.

- [ ] **Step 3: Implement the command**

Add `sessionStore.markUnread(id)` which validates `last_message_at`, stores an ISO timestamp one millisecond earlier, and returns it. Route the new command through HTTP/runtime dispatch and WS RPC, emit canonical state, refresh secretary attention when relevant, and log with `sessionId` and `lastReadAt`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/session-command-types.test.ts tests/integration/session-command-service.test.ts`

Expected: all focused tests pass.

### Task 2: Desktop first-level attention actions

**Files:**
- Create: `ui/src/components/chat/SessionAttentionActions.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/session-dock.store.ts`
- Modify: `ui/src/services/command-client.ts`
- Test: `tests/unit/session-attention-actions-pc.test.ts`
- Test: `tests/unit/session-dock-store.test.ts`

**Interfaces:**
- Consumes: `useSessionDockStore.add/remove/items` and `sessions.markUnread`.
- Produces: direct desktop buttons in approved order and `markUnread(sessionId): Promise<void>` in the desktop Session store.

- [ ] **Step 1: Write failing desktop render/store tests**

Assert exact action order, dynamic pin label, `sessions.markUnread` request, and successful Session deselection with unread state retained.

- [ ] **Step 2: Run focused desktop tests and verify RED**

Run: `npx vitest run tests/unit/session-attention-actions-pc.test.ts tests/unit/session-dock-store.test.ts`

Expected: failures because the component and store action do not exist.

- [ ] **Step 3: Implement desktop actions**

Create a focused action component using Lucide `Pin`, `PinOff`, and `Mail`. Insert it between Share and Timeline, load Dock state as needed, disable duplicate requests, and clear only the selected Session after mark-unread succeeds.

- [ ] **Step 4: Run focused desktop tests and verify GREEN**

Run the same focused command and expect all tests to pass.

### Task 3: Mobile composer expansion panel

**Files:**
- Create: `mobile/src/components/chat/SessionAttentionPanel.tsx`
- Modify: `mobile/src/components/chat/ChatInput.tsx`
- Modify: `mobile/src/pages/ChatPage.tsx`
- Modify: `mobile/src/stores/session.store.ts`
- Modify: `mobile/src/stores/pinned-session.store.ts`
- Test: `tests/unit/session-attention-actions-mobile.test.ts`
- Test: `tests/unit/mobile-session-store.test.ts`

**Interfaces:**
- Consumes: mobile pinned store `add/remove/isPinned`, mobile Session store `markUnread`, and ChatPage `returnTo`.
- Produces: a `+` button immediately after send/stop and a two-action expandable panel below the composer.

- [ ] **Step 1: Write failing mobile render/store tests**

Assert button order, exactly two panel actions, dynamic pin label, command persistence, and successful navigation callback after mark-unread.

- [ ] **Step 2: Run focused mobile tests and verify RED**

Run: `npx vitest run tests/unit/session-attention-actions-mobile.test.ts tests/unit/mobile-session-store.test.ts`

Expected: failures because the panel and store action do not exist.

- [ ] **Step 3: Implement the mobile panel**

Keep drafts intact, blur the textarea when opening, animate the panel below the form, close it on backdrop/plus/back, keep the plus available while running, toggle pin without navigation, and return only after mark-unread succeeds.

- [ ] **Step 4: Run focused mobile tests and verify GREEN**

Run the same focused command and expect all tests to pass.

### Task 4: Documentation, verification, review, and integration

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`

**Interfaces:**
- Consumes: completed backend, desktop, and mobile behavior.
- Produces: documented protocol/state semantics and a reviewed release commit.

- [ ] **Step 1: Document the feature**

Describe `sessions.markUnread`, timestamp semantics, desktop action placement, and mobile composer panel without adding implementation steps to architecture docs.

- [ ] **Step 2: Run complete verification**

Run: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.

Expected: all commands exit zero.

- [ ] **Step 3: Review the diff**

Check command completeness, current-Session race handling, pin synchronization, mobile keyboard/draft behavior, empty Session behavior, file-size limits, and user-visible Chinese copy.

- [ ] **Step 4: Commit and merge**

Create one feature commit on `feat/session-attention-actions`, perform an independent code review, then merge into `prd` with `--no-ff` without restarting PRD services.
