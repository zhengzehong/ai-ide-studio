# PRD Latency Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging for investigation and superpowers:verification-before-completion before reporting completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose and reduce frequent HTTP refresh stalls and delayed background message pushes on the `prd` branch instance at `http://106.53.210.241:18910/workspace`.

**Architecture:** Treat the issue as a multi-boundary latency problem: browser HTTP/WS -> gateway RPC handlers -> session/task/event services -> SQLite store -> ACP agent runtime. First gather evidence from logs, live probes, and code paths, then apply the smallest confirmed fix.

**Tech Stack:** Hono, ws, better-sqlite3, Pino, Vite/React, Vitest.

---

### Task 1: Baseline Runtime Evidence

**Files:**
- Read: `package.json`
- Read: `src/core/logger.ts`
- Read: `src/entry.ts`
- Read: runtime log files under `data*/logs/`

- [ ] **Step 1: Confirm branch and local changes**

Run: `git branch --show-current`

Expected: output is `prd`.

Run: `git status --short`

Expected: record any existing local changes and avoid reverting unrelated work.

- [ ] **Step 2: Locate log and data directories**

Run: `Get-ChildItem -Force -Directory | Where-Object { $_.Name -like 'data*' }`

Expected: identify the active PRD data directory, usually `data-prd`.

Run: `Get-ChildItem -Recurse -File data-prd/logs,data/logs -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 10 FullName,LastWriteTime,Length`

Expected: identify the newest backend log file.

- [ ] **Step 3: Probe external HTTP endpoint**

Run: `curl.exe -sS -o NUL -w "code=%{http_code} total=%{time_total} connect=%{time_connect} starttransfer=%{time_starttransfer}\n" http://106.53.210.241:18910/workspace`

Expected: record HTTP code and timings. Re-run several times if latency is intermittent.

- [ ] **Step 4: Inspect latest warnings and errors**

Run: `Select-String -Path data-prd/logs/app.log,data/logs/app.log -Pattern 'error|warn|watchdog|slow|failed|timeout|blocked|ECONN|SQLITE|WebSocket|prompt cleanup|session done|broadcast' -CaseSensitive:$false -ErrorAction SilentlyContinue | Select-Object -Last 200`

Expected: list concrete log evidence with timestamps and IDs.

### Task 2: HTTP And WS Boundary Review

**Files:**
- Read: `src/gateway/`
- Read: `src/types/ws-protocol.ts`
- Read: `ui/src/services/`
- Read: `ui/src/stores/`

- [ ] **Step 1: Find HTTP route handlers**

Run: `rg -n "app\\.|route|serve|Hono|fetch\\(" src/gateway src/entry.ts`

Expected: identify routes serving workspace assets, API calls, and WS upgrade.

- [ ] **Step 2: Find WS request handling and broadcasts**

Run: `rg -n "WebSocket|ws|broadcast|send\\(|requestId|RPC|rpc|message" src/gateway src/core src/types ui/src/services ui/src/stores`

Expected: identify how frontend requests, backend responses, and push events flow.

- [ ] **Step 3: Check for synchronous work inside request handlers**

Run: `rg -n "readFileSync|writeFileSync|readdirSync|execSync|spawnSync|better-sqlite3|prepare\\(|transaction|JSON\\.stringify" src/gateway src/core src/store`

Expected: mark any synchronous filesystem, database, or serialization work on HTTP/WS hot paths.

### Task 3: Session, Task, And Store Hot Path Review

**Files:**
- Read: `src/core/sessions*`
- Read: `src/core/tasks*`
- Read: `src/store/`
- Read: `src/acp/host.ts`

- [ ] **Step 1: Trace prompt and message lifecycle**

Run: `rg -n "prompt received|human message persisted|ensure session|prompt cleanup|done received|message finalized|watchdog|active prompt" src`

Expected: map each log message to the owning function and boundary.

- [ ] **Step 2: Inspect database query patterns**

Run: `rg -n "SELECT|INSERT|UPDATE|DELETE|ORDER BY|LIMIT|transaction|PRAGMA" src/store src/core`

Expected: identify unbounded queries, missing pagination, or transactions wrapping slow operations.

- [ ] **Step 3: Compare log timelines**

Run: use IDs from Task 1 logs and search exact `sessionId`, `agentId`, `taskId`, `turnId`, or `requestId`.

Expected: determine whether delay happens before request handling, during DB persistence, during ACP prompt execution, or during WS broadcast.

### Task 4: Confirm Root Cause And Apply Minimal Fix

**Files:**
- Modify only files proven by Tasks 1-3.
- Test: targeted `tests/unit/*.test.ts` or `tests/integration/*.test.ts` when behavior changes.

- [ ] **Step 1: State the root cause hypothesis**

Record: "I think the root cause is X because logs show Y and code path Z blocks or delays W."

Expected: one specific hypothesis, not a list of guesses.

- [ ] **Step 2: Add a failing test or diagnostic assertion**

Run: targeted Vitest command for the affected module.

Expected: test fails before the fix when the behavior is reproducible in-process. If the issue is environmental or timing-only, document why an automated failing test is not practical and add focused logging instead.

- [ ] **Step 3: Implement the smallest fix**

Use `apply_patch` for source edits.

Expected: change addresses the confirmed boundary only.

- [ ] **Step 4: Verify**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build succeeds.

Run: `npm run lint`

Expected: no new lint errors.

Run: `git diff --check`

Expected: no whitespace errors.

### Task 5: Report Findings

**Files:**
- Update architecture docs only if a module, WS method, entity, or user-facing feature changes.
- Update `README.md` only if user-facing behavior changes.

- [ ] **Step 1: Summarize evidence**

Include concrete timings, log timestamps, and code paths.

- [ ] **Step 2: Summarize root causes and mitigations**

Separate confirmed causes from plausible risks.

- [ ] **Step 3: Summarize verification**

List exact commands and results.
