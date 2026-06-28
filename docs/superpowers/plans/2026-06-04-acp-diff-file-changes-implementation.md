# ACP Diff File Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ACP diff file changes a durable chat feature: historical messages show lightweight "查看变更" summaries without loading full tool JSON, and users can expand details on demand.

**Architecture:** Backend stores a lightweight per-message file-change summary derived only from ACP `content.type = 'diff'`; full detail remains recoverable from persisted tool calls through a lazy RPC. Frontend renders live changes from loaded process blocks and historical summaries from message DTOs, then loads details only when the user expands the file-change card.

**Tech Stack:** Hono RPC, better-sqlite3 migrations, TypeScript, React, Zustand, Vitest.

---

### Task 1: Backend File-Change Summary Contract

**Files:**
- Create: `src/store/file-changes.ts`
- Create: `src/store/migrations/008-message-file-changes.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/migrations/001-initial-schema.ts`
- Modify: `src/store/sessions.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Test: `tests/unit/file-changes.test.ts`
- Test: `tests/integration/session-file-changes.test.ts`
- Test: `tests/integration/sqlite-migration.test.ts`

- [x] Write failing unit tests for extracting only ACP diff content, ignoring `locations`, deduplicating by path, and producing real line diff counts from `oldText/newText`.
- [x] Write failing integration tests proving `messages.file_changes_json` is persisted, lightweight `sessions.messages` returns file-change summary while stripping old tool JSON, and `sessions.messageFileChanges` returns full detail.
- [x] Add `FileChangeSummaryData` and `FileChangeDetailData` to `src/types/ws-protocol.ts`.
- [x] Add migration `008-message-file-changes` with `ALTER TABLE messages ADD COLUMN file_changes_json TEXT`.
- [x] Update fresh schema and legacy JSON import path to include `file_changes_json`.
- [x] Implement `src/store/file-changes.ts` with summary/detail helpers.
- [x] Update `messageStore.append()` and `lightweightMessage()` to compute and expose lightweight summaries.
- [x] Add RPC `sessions.messageFileChanges`.
- [x] Run targeted tests for file-change extraction, session history, and migrations.

### Task 2: Frontend Historical Summary And Detail UI

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/components/chat/file-changes-utils.ts`
- Modify: `ui/src/components/chat/FileChangesCard.tsx`
- Modify: `ui/src/components/chat/TurnContentView.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/file-changes.test.ts`
- Test: `tests/unit/message-merge.test.ts`

- [x] Extend frontend message/detail types with `file_changes_json`, `has_file_changes`, and `file_change_count`.
- [x] Cache lazy file-change details by message id in `session.store.ts`.
- [x] Change the bottom card to show "查看变更" only; remove "撤销" and "审核" placeholders.
- [x] Render live changes from process blocks and historical changes from `file_changes_json`.
- [x] Load full file-change details through `sessions.messageFileChanges` when the card is expanded and details are not already loaded.
- [x] Keep `locations` out of file-change summaries.
- [x] Run targeted frontend/store tests.

### Task 3: Docs And Verification

**Files:**
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/overview.md`
- Modify: `README.md` if the user-facing feature list needs it.

- [x] Document `messages.file_changes_json`.
- [x] Document `sessions.messageFileChanges`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run `git diff --check`.
- [x] Review `git diff` and confirm unrelated dirty files were not changed.
