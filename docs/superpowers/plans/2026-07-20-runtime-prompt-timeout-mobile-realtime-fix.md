# Runtime Prompt Timeout And Mobile Realtime Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent long ACP prompts from being falsely failed after 30 seconds and make mobile Realtime connection failures visible and recoverable.

**Architecture:** Keep API, Realtime, and Runtime process isolation unchanged. Treat `prompt` as a long-lived Runtime operation whose lifetime is bounded by explicit cancellation or process exit, while retaining the generic timeout for short control commands. On mobile, normalize the configured API address to its HTTP origin before endpoint discovery and route every disconnected state to the existing connection screen; successful reconnects continue to trigger the existing full bootstrap refresh.

**Tech Stack:** TypeScript, Node child-process IPC, React 19, Zustand, Vitest.

---

### Task 1: Long Prompt Lifetime

**Files:**
- Modify: `tests/integration/runtime-process.test.ts`
- Modify: `src/runtime/api/process-runtime-port.ts`

- [x] **Step 1: Write the failing integration test**

Add a Runtime process test with `requestTimeoutMs: 100`, a mock prompt long enough to run for more than 100 ms, and an `onDone` collector. Assert that `runtime.prompt(...)` resolves and exactly one done event is received.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/runtime-process.test.ts`

Expected: FAIL with `Runtime request timed out: prompt`.

- [x] **Step 3: Exempt only prompt from the generic request timeout**

Change `PendingRequest.timer` to optional. In `ProcessRuntimePortController.request`, create the timeout only when `command.operation !== 'prompt'`; keep send failure, Runtime process exit, and explicit close rejecting pending prompts.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/runtime-process.test.ts tests/integration/runtime-crash-recovery.test.ts`

Expected: PASS, including crash rejection of an in-flight prompt.

### Task 2: Mobile Realtime Connection Visibility

**Files:**
- Modify: `tests/unit/mobile-connection-store.test.ts`
- Modify: `mobile/src/stores/connection.store.ts`
- Modify: `mobile/src/App.tsx`

- [x] **Step 1: Write failing connection-state tests**

Update `shouldShowConnectPage` expectations so configured-but-connecting and configured-but-failed states show the connection page. Add endpoint-resolution coverage proving a saved URL with a path, such as `http://host:18900/app/`, discovers from `http://host:18900/api/v1/realtime-config` and falls back to `ws://host:18900`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/mobile-connection-store.test.ts tests/unit/mobile-app-bootstrap.test.ts`

Expected: FAIL because `shouldShowConnectPage` ignores connection state and endpoint discovery appends the API route to the saved path.

- [x] **Step 3: Implement the minimum mobile fix**

Make `shouldShowConnectPage` return true whenever no server is configured or the socket is not connected. Normalize configured HTTP/HTTPS/WS/WSS URLs to an HTTP(S) origin for discovery and build the fallback WebSocket URL from that origin. Keep the existing `connected` effect in `mobile/src/App.tsx`, which already re-runs `bootstrapMobileData()` after each successful reconnect.

- [x] **Step 4: Run the mobile tests to verify they pass**

Run: `npx vitest run tests/unit/mobile-connection-store.test.ts tests/unit/mobile-app-bootstrap.test.ts`

Expected: PASS.

### Task 3: Regression Verification And Review

**Files:**
- Update: `docs/superpowers/plans/2026-07-20-runtime-prompt-timeout-mobile-realtime-fix.md`

- [x] **Step 1: Run targeted regressions**

Run: `npx vitest run tests/integration/runtime-process.test.ts tests/integration/runtime-crash-recovery.test.ts tests/unit/mobile-connection-store.test.ts tests/unit/mobile-app-bootstrap.test.ts`

Expected: PASS.

- [x] **Step 2: Run repository gates**

Run: `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.

Expected: all commands exit 0.

- [x] **Step 3: Commit and request review**

Commit the scoped source, tests, and plan on `fix/runtime-prompt-timeout-mobile-realtime`, then send the commit range and acceptance checklist to the existing code reviewer. Do not merge to `prd` before approval.
