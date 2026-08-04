# Runtime Process Resilience Implementation Plan

## Goal

Prevent the known Runtime cursor race and ensure detached asynchronous failures cannot terminate a shared Runtime, Edge API, or Realtime process without a controlled recovery path.

## Scope

- Freeze persistence cursors before asynchronous batch writes.
- Keep update write chains usable after a failed batch.
- Handle timer-driven flush failures without creating unhandled rejections.
- Wait for a restarting Runtime before sending requests that have not yet entered IPC.
- Add local error boundaries to the identified detached Runtime and Realtime promises.
- Add structured Runtime generation and restart lifecycle logs.

## Non-goals

- Do not automatically replay prompts that were already sent to a Runtime.
- Do not change the database schema, WebSocket protocol, frontend, or model behavior.
- Do not restart or stop the running PRD deployment.
- Do not introduce per-Agent Runtime process sharding in this change.

## Steps

- [x] Add a regression test that blocks an earlier persistence item while a newer update with the same key receives a new UI cursor.
- [x] Snapshot every persistence update and cursor before the first asynchronous send.
- [x] Add tests for timer flush rejection and write-chain recovery, then contain detached coalescer failures without hiding awaited failures.
- [x] Add restart-window tests, then make unsent requests wait for the next Runtime generation with a bounded timeout.
- [x] Add rejection tests and local catches for detached Runtime capabilities and Realtime/IPC handlers.
- [x] Add restart lifecycle logging with Runtime PID, generation, reason, and elapsed time.
- [x] Run focused tests, full tests, TypeScript/build, lint, and `git diff --check`; review the complete diff before merging to `prd`.

## Acceptance Criteria

- The reproduced cursor race completes with distinct cursors and no missing-cursor error.
- A failed background flush is reported exactly once and does not become an unhandled rejection.
- A failed write batch does not poison later batches.
- Requests created during a Runtime restart wait for readiness; in-flight prompts are not replayed.
- Identified detached promises have explicit local rejection handling.
- Existing Runtime, Realtime, and session tests remain green.
