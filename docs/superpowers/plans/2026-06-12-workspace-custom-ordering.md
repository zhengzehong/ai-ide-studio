# Workspace Custom Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users manually order Workspace sidebar Agents and each Agent's sessions, with ordering persisted across reloads and synced to the `prd` branch.

**Architecture:** Add `sort_order` fields to `agents` and `sessions`, expose batch reorder RPCs, and keep Workspace rendering driven by sorted store data. The frontend uses a small helper for stable reordering plus a sidebar sorting mode with drag handles and up/down controls.

**Tech Stack:** Hono RPC, better-sqlite3 migrations, React 19, Zustand, Vitest.

---

### Task 1: Persisted Ordering Model

**Files:**
- Create: `src/store/migrations/015-workspace-custom-ordering.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/agents.ts`
- Modify: `src/store/sessions.ts`
- Test: `tests/integration/workspace-ordering.test.ts`

- [x] Add failing tests for migrated `sort_order`, default list order, and batch reordering.
- [x] Run `npx vitest run tests/integration/workspace-ordering.test.ts` and verify it fails because `sort_order`/reorder APIs do not exist.
- [x] Add migration `015` with `sort_order` columns and backfill existing rows using current visible order.
- [x] Add `sort_order` to `AgentRow`, `SessionRow`, create/list SQL, and store-level `reorder` methods.
- [x] Run targeted ordering tests and confirm they pass.

### Task 2: RPC And Store Wiring

**Files:**
- Modify: `src/gateway/rpc/agents.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `ui/src/stores/agent.store.ts`
- Modify: `ui/src/stores/session.store.ts`
- Test: `tests/integration/workspace-ordering-rpc.test.ts`

- [x] Add failing RPC tests for `agents.reorder` and `sessions.reorder` project/scope validation.
- [x] Run `npx vitest run tests/integration/workspace-ordering-rpc.test.ts` and verify it fails because the RPCs do not exist.
- [x] Add typed WS messages and RPC handlers.
- [x] Add frontend store methods that optimistically apply returned ordered rows.
- [x] Run targeted RPC tests and confirm they pass.

### Task 3: Workspace Sidebar UI

**Files:**
- Create: `ui/src/pages/workspace/ordering.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/workspace-ordering.test.ts`

- [x] Add failing helper tests for stable manual sorting and moving items.
- [x] Run `npx vitest run tests/unit/workspace-ordering.test.ts` and verify it fails because helper functions do not exist.
- [x] Add ordering helper functions.
- [x] Add a compact sorting mode in the Workspace sessions sidebar.
- [x] Wire Agent and per-Agent session drag/drop plus up/down buttons to reorder RPCs.
- [x] Run targeted helper tests and a focused Workspace TypeScript/build check.

### Task 4: Verification, Review, Commit, And PRD Sync

**Files:**
- Review all changed files.

- [x] Run targeted tests for ordering helpers, store, and RPC.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect the staged diff.
- [ ] Commit the current branch.
- [ ] Cherry-pick/update `D:\code_space\python_space\ai-ide-studio-prd` and repeat targeted validation there.
