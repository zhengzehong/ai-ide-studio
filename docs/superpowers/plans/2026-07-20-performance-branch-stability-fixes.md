# Performance Branch Stability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the confirmed Writer lock race and restore non-blocking permission/cancel behavior plus Codex/Claude default full-access modes on the isolated performance branch.

**Architecture:** Keep the current compatibility writers, but make Writer transactions acquire an immediate reservation and give all read-write SQLite connections a bounded busy wait. Split durable HTTP commands into per-type session lanes so control commands can unblock a running prompt, and share one pure default-mode resolver between embedded and process Runtime implementations.

**Tech Stack:** TypeScript 6, Node.js Worker Threads/child processes, better-sqlite3 WAL, ACP SDK, Vitest, PowerShell.

---

### Task 1: Prevent Writer Snapshot Upgrade Locks

**Files:**
- Modify: `tests/integration/writer-worker.test.ts`
- Modify: `src/data-worker/writer-worker/operations.ts`
- Modify: `src/store/db.ts`
- Modify: `src/data-worker/protocol.ts`
- Modify: `src/data-worker/writer-worker/entry.ts`

- [ ] **Step 1: Write the failing real-contention test**

Add a test that keeps the API database open, executes `BEGIN IMMEDIATE`, submits a Writer `session.touch` batch, releases the API transaction after 100ms, and expects the Writer batch to commit rather than reject with `database is locked`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/integration/writer-worker.test.ts -t "waits for a concurrent API writer"`

Expected: FAIL with `WorkerRequestError: database is locked` on the deferred Writer transaction.

- [ ] **Step 3: Acquire the Writer transaction immediately**

Change `executeWriteBatches` to invoke the transaction wrapper through its `immediate` variant:

```ts
const execute = db.transaction((items: WriteBatch[]) => items.map((batch) => commitBatch(db, batch)))
return execute.immediate(batches)
```

Set `busy_timeout = 5000` in `initDatabase` before migrations. Extend `WorkerErrorCode` with the SQLite busy/locked codes used by better-sqlite3, and map native errors without hiding their code.

- [ ] **Step 4: Run the Writer tests and verify GREEN**

Run: `npx vitest run tests/integration/writer-worker.test.ts tests/integration/session-persistence-worker.test.ts`

Expected: all tests pass; contention test completes after the API lock is released.

- [ ] **Step 5: Commit the SQLite fix**

```powershell
git add tests/integration/writer-worker.test.ts src/data-worker/writer-worker/operations.ts src/store/db.ts src/data-worker/protocol.ts src/data-worker/writer-worker/entry.ts
git commit -m "fix: prevent writer snapshot lock failures"
```

### Task 2: Let Control Commands Unblock Prompts

**Files:**
- Modify: `tests/integration/runtime-command-ledger.test.ts`
- Modify: `src/commands/runtime-command-dispatcher.ts`

- [ ] **Step 1: Write failing dispatcher lane tests**

Use a fake ledger and a controlled `execute` promise. Submit an unresolved prompt, then submit `permission.respond` and `session.cancel` for the same session. Assert both control commands reach `execute` and complete before the prompt is released. Add a second test asserting two prompts for the same session still execute in order.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run tests/integration/runtime-command-ledger.test.ts -t "running prompt"`

Expected: timeout/assertion failure because the current single session tail does not execute control commands.

- [ ] **Step 3: Introduce per-command session lanes**

Replace the session-only tail key with a lane key derived from `RuntimeCommandRecord.type`:

```ts
function commandLane(command: RuntimeCommandRecord): string {
  return `${command.sessionId}:${command.type === 'prompt' ? 'prompt' : command.type}`
}
```

Track and drain all lane tails. Preserve `completionByCommand`, ledger status transitions, idempotency, recovery behavior, and prompt-to-prompt ordering.

- [ ] **Step 4: Register pending interactions before publishing**

Modify `src/runtime/service/acp-runtime-client.ts` so `waitForInteraction` creates and stores the pending entry before `publish` sends the permission or elicitation request. Add a unit test in `tests/unit/acp-runtime-client.test.ts` where `publishUpdate` immediately calls `resolvePermission`; expect the ACP request promise to resolve successfully.

- [ ] **Step 5: Run dispatcher and interaction tests**

Run: `npx vitest run tests/integration/runtime-command-ledger.test.ts tests/integration/session-command-service.test.ts tests/unit/acp-runtime-client.test.ts`

Expected: all tests pass without releasing the prompt before the control command assertions.

- [ ] **Step 6: Commit the command fix**

```powershell
git add tests/integration/runtime-command-ledger.test.ts tests/unit/acp-runtime-client.test.ts src/commands/runtime-command-dispatcher.ts src/runtime/service/acp-runtime-client.ts
git commit -m "fix: isolate runtime control command lanes"
```

### Task 3: Restore Runtime Default Permission Modes

**Files:**
- Create: `src/acp/runtime-mode-preference.ts`
- Modify: `src/acp/session-runtime-preferences.ts`
- Modify: `src/runtime/service/sdk-runtime-host.ts`
- Create: `tests/unit/runtime-mode-preference.test.ts`
- Modify: `tests/unit/acp-session-runtime-preferences.test.ts`

- [ ] **Step 1: Write failing pure resolver tests**

Assert `resolveDesiredRuntimeMode('codex', undefined)` returns `agent-full-access`, Claude returns `bypassPermissions`, a saved mode wins, and unknown runtimes return `undefined`.

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `npx vitest run tests/unit/runtime-mode-preference.test.ts`

Expected: FAIL because the shared resolver does not exist.

- [ ] **Step 3: Implement and share the resolver**

Create a pure named export and use it in both Runtime preference paths:

```ts
const DEFAULT_MODE_BY_RUNTIME: Readonly<Record<string, string>> = {
  codex: 'agent-full-access',
  claude: 'bypassPermissions',
}

export function resolveDesiredRuntimeMode(runtime: string, savedModeId?: string): string | undefined {
  return savedModeId ?? DEFAULT_MODE_BY_RUNTIME[runtime]
}
```

In `SdkRuntimeHost.applyPreferences`, only call `setMode` when the resolved mode exists in `session.capabilities.modes`; keep the current mode and log a contextual warning otherwise.

- [ ] **Step 4: Run Runtime preference tests and verify GREEN**

Run: `npx vitest run tests/unit/runtime-mode-preference.test.ts tests/unit/acp-session-runtime-preferences.test.ts tests/integration/runtime-command-parity.test.ts`

Expected: all tests pass and embedded/process paths select the same default mode.

- [ ] **Step 5: Commit the Runtime mode fix**

```powershell
git add src/acp/runtime-mode-preference.ts src/acp/session-runtime-preferences.ts src/runtime/service/sdk-runtime-host.ts tests/unit/runtime-mode-preference.test.ts tests/unit/acp-session-runtime-preferences.test.ts
git commit -m "fix: restore runtime default permission modes"
```

### Task 4: Add the Isolated Performance Launcher

**Files:**
- Create: `scripts/start-performance-local.ps1`
- Modify: `README.md`

- [ ] **Step 1: Add guarded launcher configuration**

Create a PowerShell launcher that defaults to `AI_IDE_PERF_PORT=19000`, rejects port `18900`, sets `DATA_DIR=$Root/data-perf`, `LOG_DIR=$Root/data-perf/logs`, `EDGE_MODE=process`, builds, and starts the app. If the selected port is already listening, exit with an error instead of terminating the existing process.

- [ ] **Step 2: Add startup documentation**

Document `powershell -ExecutionPolicy Bypass -File scripts/start-performance-local.ps1`, the isolated URL, data directory, and the prohibition on using the PRD port/data.

- [ ] **Step 3: Validate the launcher guard**

Run: `$env:AI_IDE_PERF_PORT='18900'; powershell -ExecutionPolicy Bypass -File scripts/start-performance-local.ps1`

Expected: non-zero exit before build/start with an explicit reserved-port error.

- [ ] **Step 4: Commit the launcher**

```powershell
git add scripts/start-performance-local.ps1 README.md
git commit -m "chore: isolate performance branch launcher"
```

### Task 5: Full Verification and Review Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-07-20-performance-branch-stability-fixes.md`

- [ ] **Step 1: Run targeted regression tests**

```powershell
npx vitest run tests/integration/writer-worker.test.ts tests/integration/runtime-command-ledger.test.ts tests/integration/session-command-service.test.ts tests/unit/acp-runtime-client.test.ts tests/unit/runtime-mode-preference.test.ts tests/unit/acp-session-runtime-preferences.test.ts
```

- [ ] **Step 2: Run mandatory repository verification**

```powershell
npm test
npm run build
npm run lint
git diff --check dbead4d..HEAD
```

Expected: all commands exit 0 with no test, type, lint, build, or whitespace failures.

- [ ] **Step 3: Start the isolated instance**

Run `scripts/start-performance-local.ps1`, confirm only `19000` is exposed by this instance, open `http://127.0.0.1:19000/`, and verify its database/log paths are under the worktree `data-perf` directory. Do not stop or modify the PRD listener on `18900`.

- [ ] **Step 4: Update this checklist and commit evidence**

Mark completed checkboxes, record verification totals, then commit the plan update.

- [ ] **Step 5: Request code review without merging PRD**

Send the commit range and acceptance checklist to the existing code reviewer. Keep `feat/single-port-edge-gateway` checked out and wait for user approval before any merge.
