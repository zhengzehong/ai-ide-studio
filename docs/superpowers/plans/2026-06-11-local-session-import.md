# Local Session Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project Agent right-click flow to import local Codex / Claude Code JSONL sessions by binding their native session id to a new platform session.

**Architecture:** Keep history parsing out of scope. Backend parses only JSONL metadata, validates runtime/project context, creates an empty platform session with `acp_session_id`, and exposes a limited local candidate list. Frontend adds an Agent context-menu entry and a modal that can import by path or selected candidate.

**Tech Stack:** Hono RPC handlers, better-sqlite3 stores, Vitest, React 19, Zustand, Vite.

---

### Task 1: Backend Parser And Candidate Scanner

**Files:**
- Create: `src/core/local-session-import.ts`
- Test: `tests/unit/local-session-import.test.ts`

- [x] Write parser tests for Codex `session_meta.payload.id`.
- [x] Write parser tests for Claude `sessionId` and filename UUID fallback.
- [x] Write tests for runtime mismatch and limited candidate sorting.
- [x] Implement metadata parsing with bounded line reads.
- [x] Implement candidate scanning for Codex and Claude homes.
- [x] Run `npm test -- tests/unit/local-session-import.test.ts`.

### Task 2: Session Import RPC

**Files:**
- Modify: `src/gateway/rpc/sessions.ts`
- Test: `tests/integration/session-local-import-rpc.test.ts`

- [x] Write integration tests for `sessions.importLocal`.
- [x] Write integration tests for `sessions.listLocalImportCandidates`.
- [x] Validate Agent existence, project ownership, runtime matching, and cwd warnings.
- [x] Create empty platform session with `acp_session_id`.
- [x] Return warnings without creating historical messages or events.
- [x] Run `npm test -- tests/integration/session-local-import-rpc.test.ts`.

### Task 3: Frontend Store And Workspace UI

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Add store methods for listing candidates and importing local sessions.
- [x] Add Agent row context menu entry `导入本地会话`.
- [x] Add modal with path input, local candidate list, loading, importing, error, and warning states.
- [x] On successful import, insert/select the new empty session.
- [x] Preserve existing session context menu behavior.

### Task 4: Verification And Commit

**Files:**
- Review all feature files and related docs.

- [x] Run targeted backend tests.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run `git diff --check`.
- [x] Review diff for unrelated files.
- [x] Commit only related files.
- [x] Merge or cherry-pick commit into `prd`.
