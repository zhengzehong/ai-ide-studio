# Chat Active Turn Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable realtime chat streaming by separating historical message rendering from the current active turn.

**Architecture:** Historical chat rows are rendered from `messages` as the primary source. The current generating turn is rendered from `streamingMessage` and is never hidden by historical timeline de-duplication. The ACP adapter creates a fresh generated message id for each prompt turn when the runtime does not provide one.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, ACP SDK, SQLite.

---

### Task 1: Documentation

**Files:**
- Create: `docs/design/chat-conversation-behavior.md`
- Create: `docs/superpowers/plans/2026-06-02-chat-active-turn-streaming.md`

- [x] Write the confirmed conversation interaction design.
- [x] Write this implementation task list before touching code.

### Task 2: Lock frontend rendering behavior with tests

**Files:**
- Modify: `tests/unit/chat-render-items.test.ts`
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [x] Add a test that a streaming bubble remains visible even when its id matches historical events.
- [x] Add a test that loaded messages are preferred over historical event timeline groups.
- [x] Add a test that hidden lifecycle updates do not clear the local pending streaming placeholder.
- [x] Add a test that `session:done` refreshes persisted messages as well as events.
- [x] Run targeted tests and confirm they fail before implementation.

### Task 3: Fix frontend active-turn rendering

**Files:**
- Modify: `ui/src/components/chat/render-items.ts`
- Modify: `ui/src/stores/session.store.ts`

- [x] Render loaded historical `messages` as the primary chat list when available.
- [x] Always append the current streaming bubble when `showStreamingBubble` is true and the session matches.
- [x] Ignore hidden lifecycle updates during live streaming instead of clearing the pending placeholder.
- [x] Refresh both `sessions.messages` and `sessions.events` after `session:done`.
- [x] Run targeted frontend unit tests.

### Task 4: Fix ACP generated message id lifecycle

**Files:**
- Modify: `src/acp/client-handler.ts`
- Modify: `src/acp/host.ts`
- Test: `tests/unit/acp-turn-message-id.test.ts`

- [x] Add a unit test proving two prompt turns in the same ACP session get different generated message ids when the runtime omits `messageId`.
- [x] Add helper functions to start/end a client turn for an ACP session.
- [x] Call start before `connection.prompt()` and end after the prompt finishes.
- [x] Run targeted unit test.

### Task 5: Verification

**Commands:**
- `npm test`
- `npm run build`
- `npm run lint`
- `git diff --check`

- [x] All tests pass.
- [x] Build passes.
- [x] Lint has no new errors.
- [x] Diff whitespace check passes.
- [x] Report changed files and any unrelated existing dirty files separately.
