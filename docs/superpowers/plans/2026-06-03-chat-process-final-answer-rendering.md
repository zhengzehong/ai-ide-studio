# Chat Process And Final Answer Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the chat design where each agent turn has an ordered, collapsible execution process and a separate final answer.

**Architecture:** Add a focused `turn-blocks` domain module as the single source of truth for classifying realtime/events into execution-process blocks and final-answer text. Keep realtime UI driven by `session:update`; use `messages` for fast final-answer history; use `session_events` to reconstruct process blocks for active recovery and future lazy history expansion. UI components render the domain model and must not infer ordering from flattened `tool_calls_json`.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest, existing WS RPC/session store.

---

## Stable boundaries

- `ui/src/stores/turn-blocks.ts`: domain model and pure reducers for ordered turn blocks. No React, no WebSocket, no SQLite assumptions.
- `ui/src/stores/streaming-buffer.ts`: preserves realtime update order while batching flushes.
- `ui/src/stores/session-events.ts`: session/event DTOs plus event-history recovery helpers. It may call `turn-blocks`, but UI-specific rendering does not live here.
- `ui/src/stores/session.store.ts`: orchestrates WS events and stores current active turn state. It must not decide visual ordering itself.
- `ui/src/components/chat/render-items.ts`: chooses which chat items to show for a selected session. It does not flatten process blocks.
- `ui/src/pages/Workspace.tsx`: renders the already-classified model. It can own presentation state such as expand/collapse, but not classification rules.

## Tasks

### Task 1: Add ordered turn-block domain model

- [ ] Write failing unit tests for `applyTurnEntry` / `turnFromEvents` covering: thinking, reply candidate, tool, candidate demotion after a later tool, and final-answer extraction.
- [ ] Run targeted test and verify it fails for missing exports.
- [ ] Create `ui/src/stores/turn-blocks.ts` with pure types and reducers.
- [ ] Run targeted test and verify it passes.

### Task 2: Preserve realtime entry order through batching

- [ ] Write failing unit test for `StreamingBuffer` showing `content -> tool -> content -> tool -> content` flushes in that order.
- [ ] Run targeted test and verify it fails with flattened snapshot.
- [ ] Update `StreamingBuffer` to emit ordered entries while keeping compatibility fields for existing callers during migration.
- [ ] Run targeted tests.

### Task 3: Migrate active turn store to process/final model

- [ ] Write failing store/reducer tests proving active turn keeps ordered process blocks and final answer while streaming.
- [ ] Run targeted tests and verify failure.
- [ ] Update `StreamingMessage` and store flush/done/recovery logic to use `turn-blocks`.
- [ ] Run targeted tests.

### Task 4: Render execution process and final answer

- [ ] Write failing render model tests proving active turns render as active-turn items and persisted messages remain final-answer history.
- [ ] Run targeted tests and verify failure.
- [ ] Update `render-items.ts` and `Workspace.tsx` to render `<执行过程>` plus final answer.
- [ ] Run targeted tests.

### Task 5: Validate and review

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Review diff for unrelated changes and remaining risks.
