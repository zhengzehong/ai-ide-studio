# SQLite Single Writer P0 Implementation Plan

## Goal

Remove Runtime turn-process and terminal Session writes from the API thread so
SQLite persistence is serialized through the Writer Worker. Preserve existing
Session behavior, ordering, recovery, and public protocols while building a
typed write-command foundation that later domains can reuse.

## Scope

- Add typed domain write commands and handler registration on top of the
  existing Writer Worker transport, scheduler, priorities, retries, and batch
  idempotency.
- Move turn-process upsert, text append, open-item completion, and message
  process-count updates into Writer Worker transactions.
- Move terminal Agent message finalization and related Session touch/stage
  updates needed by the Runtime completion path into an ordered critical write.
- Serialize writes per Session and drain pending Runtime persistence before
  terminal completion.
- Prevent ordinary persistence failures from terminating the shared Runtime
  process; surface them to the Session recovery path instead.
- Add focused unit and integration coverage, then run the complete repository
  verification suite.

## Out Of Scope

- Migrating Task, Rule, Agent communication, Settings, Knowledge Base, or other
  low-frequency Store writes.
- Making the API SQLite connection read-only. That becomes safe only after the
  remaining write domains are migrated.
- Changing frontend behavior, HTTP/WS contracts, or database schema.
- Restarting the running PRD services.

## Implementation Steps

1. Add failing tests for typed Writer commands, per-Session ordering, terminal
   drain, duplicate command handling, and Runtime survival after persistence
   failure.
2. Introduce the reusable domain write-command envelope, typed client method,
   and domain handler registry without changing the active write path.
3. Implement Turn Process Writer handlers and an API-side coordinator that
   coalesces/serializes writes and returns committed rows for event publication.
4. Implement the terminal Session write command and make Session completion
   wait for pending process writes before committing terminal state.
5. Isolate persistence failures from Runtime process lifecycle and preserve
   recovery diagnostics.
6. Run focused tests, lint, typecheck/build, full tests, and diff checks.
7. Perform an independent code-review pass, address findings, commit the branch,
   and merge it into `prd` without restarting PRD.

## Acceptance Criteria

- Runtime process/tool updates no longer call direct API-thread SQL writes for
  turn-process persistence.
- Terminal Session persistence is ordered after all queued process updates and
  is committed atomically for its affected rows.
- Duplicate Writer commands are idempotent and retries do not duplicate data.
- A Writer persistence error does not kill the shared Runtime process.
- Existing Session, task, frontend, and protocol behavior remains compatible.
- `npm test`, `npm run build`, `npm run lint`, and `git diff --check` pass.
