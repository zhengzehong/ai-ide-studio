# Team Dispatch Reliability Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the real Team flow failure where leader orchestration creates competing leader sessions, member dispatch reports success while the target session is busy, and reverted tasks keep stale `completed_at`.

**Architecture:** Keep changes inside the Team/session/task boundary. `team.create` reuses the caller session when available; member dispatch goes through a small in-memory queue per member session; task updates keep `completed_at` consistent with terminal status.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 stores, existing `sessionManager` and Team MCP handlers.

---

### Task 1: Add regression tests for Team session reuse and queued dispatch

**Files:**
- Modify: `tests/unit/team-tool-handlers.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that verify:
1. `team.create` uses `context.sessionId` as the leader member session instead of creating a second leader session.
2. `team.member.message` queues a dispatch when the member session is already generating and sends it after `session:done`.

- [x] **Step 2: Run red tests**

Run: `npm test -- tests/unit/team-tool-handlers.test.ts`

Expected before implementation: at least the new tests fail because leader session reuse and member dispatch queueing are not implemented.

### Task 2: Implement Team session reuse and dispatch queue

**Files:**
- Modify: `src/core/teams.ts`
- Modify: `src/tools/handlers/team/team-tools.ts`

- [x] **Step 1: Reuse current session in `teamService.create`**

Extend `CreateTeamInput` with optional `leaderSessionId`; if present, validate it belongs to the leader agent/project and store it in `team_members.session_id`; otherwise keep creating a new session.

- [x] **Step 2: Pass tool context session into `team.create` handler**

In `createTeamHandler`, pass `context.sessionId` as `leaderSessionId`.

- [x] **Step 3: Queue busy member dispatch**

Replace fire-and-forget dispatch with a per-session queue in `src/core/teams.ts`. If `sessionManager.sendPrompt` rejects with the active-prompt error, keep one pending prompt for that member session and retry when `session:done` fires.

- [x] **Step 4: Run focused Team tests**

Run: `npm test -- tests/unit/team-tool-handlers.test.ts`

Expected after implementation: all tests in the file pass.

### Task 3: Fix stale `completed_at` when reopening tasks

**Files:**
- Modify: `tests/unit/team-tool-handlers.test.ts`
- Modify: `src/store/tasks.ts`

- [x] **Step 1: Add failing test**

Add a test that completes a Team task, then updates it back to `in_progress`, and expects `completed_at` to be null.

- [x] **Step 2: Run red test**

Run: `npm test -- tests/unit/team-tool-handlers.test.ts`

Expected before implementation: the new test fails because `completed_at` remains set.

- [x] **Step 3: Update task store completion timestamp logic**

In `taskStore.updateStatus` and `taskStore.update`, set `completed_at` to now for terminal statuses, null for non-terminal statuses, and preserve existing value only when no status change is requested.

- [x] **Step 4: Run focused tests**

Run: `npm test -- tests/unit/team-tool-handlers.test.ts`

Expected after implementation: all tests in the file pass.

### Task 4: Verify real Team flow

**Files:**
- No production file changes unless the real smoke exposes a new root cause.

- [x] **Step 1: Run full automated verification**

Run:
- `npm test`
- `npm run build`
- `npm run lint`
- `git diff --check`

- [x] **Step 2: Rerun real smoke tests**

Run simple and complex real smoke with Claude leader + Codex members:

```powershell
$env:TEAM_SMOKE_LEADER_RUNTIME='claude'
$env:TEAM_SMOKE_MEMBER_RUNTIME='codex'
$env:TEAM_SMOKE_PROMPT_TIMEOUT_MS='900000'
$env:TEAM_SMOKE_POLL_TIMEOUT_MS='900000'
node --import tsx .tmp\team-real-smoke.mjs simple
node --import tsx .tmp\team-real-smoke.mjs complex
```

Expected: simple remains `ok: true`; complex reaches reviewer mailbox and completed reviewer task.

### Task 5: Debounce Team Leader wake so manual next turns are not rejected

**Files:**
- Modify: `tests/unit/team-tool-handlers.test.ts`
- Modify: `src/core/team-wake-coordinator.ts`

- [x] **Step 1: Add failing wake debounce test**

Add a test where a member sends a task-bound report, then completes the task. The leader should not be woken by the report before task completion; it should wake after the terminal task update debounce window.

- [x] **Step 2: Run red test**

Run: `npm test -- tests/unit/team-tool-handlers.test.ts`

Expected before implementation: the test fails because `team.mailbox.send` wakes the leader immediately.

- [x] **Step 3: Implement delayed, coalesced Team Leader wake**

In `src/core/team-wake-coordinator.ts`, store the latest pending wake per leader session and send it after a short delay. Task-bound report/result messages use a longer grace period so the subsequent `team.task.update(completed)` can replace the wake; terminal task updates use a short delay so manual/user next turns can win the race and automatic wake will queue behind them.

- [x] **Step 4: Run focused tests and real complex smoke again**

Run: `npm test -- tests/unit/team-tool-handlers.test.ts`, then rerun the complex smoke command.

### Task 6: Queue automatic Team prompts behind active manual turns

**Files:**
- Modify: `src/core/sessions.ts`
- Modify: `src/core/teams.ts`
- Modify: `src/core/team-wake-coordinator.ts`
- Modify: `tests/unit/team-tool-handlers.test.ts`

- [x] **Step 1: Add a queued prompt entrypoint**

Add `sessionManager.enqueuePrompt()` so system-generated Team prompts can wait for the current turn instead of rejecting like user-initiated prompts.

- [x] **Step 2: Route Team member dispatch and Leader wake through queued prompts**

Keep user/API `sendPrompt()` fail-fast for duplicate manual prompts, but make Team automation use `enqueuePrompt()`.

- [x] **Step 3: Rerun focused tests and complex smoke**

Run the Team unit tests, prompt-lock regression, then the real complex smoke again.
