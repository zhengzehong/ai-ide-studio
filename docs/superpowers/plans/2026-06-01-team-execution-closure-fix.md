# Team Execution Closure Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Team leader -> member -> task/report loop actually close without manual permission clicks, and make spawned member sessions immediately visible in the current workspace.

**Architecture:** Keep the existing Team service and ACP client boundaries. Add a small ACP auto-permission helper limited to internal `ai-ide-tools` Team tools, update Team service state transitions where messages are dispatched, and make the UI/session store accept created session events instead of waiting for a full refresh.

**Tech Stack:** TypeScript, Vitest, Hono/ws event bus, better-sqlite3 stores, Zustand frontend stores.

---

### Task 1: Guarded ACP auto-approval for internal Team tools

**Files:**
- Create: `src/acp/auto-permission.ts`
- Modify: `src/acp/client-handler.ts`
- Test: `tests/unit/acp-auto-permission.test.ts`

- [ ] Add a helper that maps ACP MCP tool titles like `mcp__ai-ide-tools__team_mailbox_send` back to platform tool names by normalizing separators.
- [ ] Only approve when all checks pass: internal server name is `ai-ide-tools`, current session belongs to a Team member, tool is visible for that session, tool permissions do not require approval, and tool name is in the safe allowlist.
- [ ] Prefer ACP `allow_always`, then `allow_once`, otherwise return no decision.
- [ ] In `requestPermission`, call the helper before emitting a UI permission request. If it returns a response, log and return it.
- [ ] Unit-test allowed Team tools, external MCP tools, hidden tools, and tools requiring approval.

### Task 2: Mark dispatched Team tasks as executing

**Files:**
- Modify: `src/core/teams.ts`
- Test: extend `tests/unit/team-service-errors.test.ts` or add `tests/unit/team-service-dispatch.test.ts`

- [ ] In `teamService.dispatchMessage`, when `taskId` is present, load the task and verify it belongs to the Team.
- [ ] If the task status is `backlog` or `planning`, update it to `executing` with a clear stage mentioning the assignee.
- [ ] Emit `task:update` and `team:update` so the board and Team panel refresh.
- [ ] Unit-test that dispatching a task changes status/stage and does not override completed tasks.

### Task 3: Emit and consume newly spawned member sessions

**Files:**
- Modify: `src/core/teams.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: extend `tests/unit/team-service-dispatch.test.ts` and add/update frontend store tests if practical.

- [ ] After `spawnMember` creates an Agent and Session, emit `session:changed` with the full session row so websocket clients can add it.
- [ ] Emit a lightweight `agent:status` or rely on workspace refresh on `team:update` for new Agent visibility; choose the smaller safe change.
- [ ] In the session store, when a `session:changed` event has enough session fields and matches the active project scope, insert it if missing.
- [ ] In `Workspace.tsx`, listen for `team:update` while connected and refresh project agents/sessions/tasks for the current project.
- [ ] Verify clicking a Team member session no longer blanks the conversation after spawn.

### Task 4: Verification

**Files:**
- Update only if needed: `docs/architecture/ws-protocol.md`, `docs/architecture/overview.md`, `docs/architecture/data-model.md`, `README.md`

- [ ] Run targeted Team/ACP tests first.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Review `git diff` to ensure no unrelated PRD/worktree files were touched.
