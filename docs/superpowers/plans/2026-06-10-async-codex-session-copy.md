# Async Codex Session Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session copy avoid unnecessary source resume and return immediately while ACP fork completes in the background.

**Architecture:** Backend `sessions.copy` creates a placeholder copied session with a copying stage, returns it immediately, and runs ACP fork asynchronously using the persisted source ACP session id. Frontend treats copying sessions as not ready, disables sending, and updates from realtime session changes.

**Tech Stack:** Hono WebSocket RPC, ACP host, SQLite session store, React/Zustand.

---

### Task 1: Backend Copy Flow

**Files:**
- Modify: `src/acp/host.ts`
- Modify: `src/core/sessions.ts`
- Modify: `tests/integration/ws-copy-session.test.ts`

- [x] Add a failing integration test that `sessions.copy` returns a placeholder immediately, does not call `ensureSession` when the source has `acp_session_id`, and later fills the copied session after fork.
- [x] Add an ACP host helper that forks from a persisted source ACP session id.
- [x] Change `sessionManager.copySession` to create a placeholder, start background fork, and use the persisted source ACP session id.
- [x] Verify the integration test passes.

### Task 2: Frontend Copy State

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Track copying target session ids in the session store.
- [x] Treat copying sessions as not ready for prompt sending.
- [x] Keep the source copy menu disabled until the copied target leaves the copying stage.
- [x] Verify existing frontend tests for session store and workspace still pass.

### Task 3: Verification And Sync

**Files:**
- Review all changed files.

- [x] Run targeted tests for copy behavior and frontend session behavior.
- [x] Run broader verification needed by the touched surface.
- [ ] Commit the current branch.
- [ ] Cherry-pick or otherwise update the `prd` branch/worktree with the commit.
