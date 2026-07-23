# Preview History Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist lightweight `preview.publish` summaries so PC and mobile restore preview cards after history reload without loading full process details.

**Architecture:** Add `messages.presentations_json`, extract summaries from finalized tool calls, and include the field in existing message read models. Realtime rendering remains unchanged; completed history renders cards from parsed summaries with `previewId` deduplication.

**Tech Stack:** TypeScript, better-sqlite3 migrations, React, Zustand, Vitest.

---

### Task 1: Persist Preview Summaries

**Files:**
- Create: `src/core/message-presentations.ts`
- Create: `src/store/migrations/047-message-presentations.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/sessions.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/unit/message-presentations.test.ts`
- Test: `tests/unit/session-finalize.test.ts`
- Test: `tests/integration/sqlite-migration.test.ts`

- [x] Write failing tests for parsing valid MCP output, rejecting malformed/error output, and saving summaries on message finalization.
- [x] Run targeted tests and confirm they fail because presentation support is absent.
- [x] Implement the typed parser, migration, message fields, append/update/copy persistence, and finalization extraction.
- [x] Run targeted backend tests and confirm they pass.
- [x] Commit the backend persistence slice.

### Task 2: Restore PC Preview Cards

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/chat/TurnContentView.tsx`
- Test: `tests/unit/session-store-done-refresh.test.ts`
- Test: `tests/unit/turn-content-view-preview.test.tsx`

- [x] Write failing tests proving a completed history message parses `presentations_json` and renders a card without process blocks.
- [x] Run targeted PC tests and confirm the card is absent before implementation.
- [x] Parse presentation summaries during message normalization and pass them into `TurnContentView`.
- [x] Render summary cards outside the process panel and deduplicate against realtime preview blocks by `previewId`.
- [x] Run targeted PC tests and confirm they pass.
- [x] Commit the PC history restoration slice.

### Task 3: Restore Mobile Preview Cards

**Files:**
- Modify: `mobile/src/stores/chat.store.ts`
- Modify: `mobile/src/components/chat/TurnContent.tsx`
- Modify: `mobile/src/components/chat/PreviewCard.tsx`
- Test: `tests/unit/mobile-preview-history.test.tsx`

- [x] Write a failing test proving a completed mobile history message renders a persisted preview summary without process blocks.
- [x] Run the targeted mobile test and confirm it fails for the missing summary path.
- [x] Parse and render mobile preview summaries using the existing preview card/navigation behavior.
- [x] Deduplicate persisted and realtime cards by `previewId`.
- [x] Run the targeted mobile test and confirm it passes.
- [x] Commit the mobile history restoration slice.

### Task 4: Verify and Review

- [x] Run all targeted preview, message, migration, PC, and mobile tests.
- [x] Run `npx tsc --noEmit`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run `git diff --check` and inspect the complete diff.
- [ ] Request independent code review and merge only after approval.
