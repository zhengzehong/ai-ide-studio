# API Dispatch Rejection P0 Fix Plan

## Goal

Prevent an asynchronously rejected task-step prompt from becoming an unhandled Promise rejection that terminates the API process, and add reliable fatal diagnostics without swallowing process-fatal errors.

## Scope

1. Add a regression test that forces `sessionManager.enqueuePrompt` to reject and verifies task rollback completes without an `unhandledRejection`.
2. Remove the orphaned rejection from `dispatchStep` while preserving its fire-and-forget dispatch semantics and existing task/step rollback behavior.
3. Register an `uncaughtExceptionMonitor` diagnostic in the API child that logs the exception origin and active prompt/turn metadata, then allows Node to retain its normal fatal behavior.
4. Run targeted tests, the full test suite, lint, build, and `git diff --check`.
5. Commit on `fix/api-dispatch-rejection`, review the diff, and merge the verified commit into `prd` without restarting the service.

## Acceptance Criteria

- Rejected step prompts do not emit an unhandled rejection.
- The affected step returns to `ready` and its task moves to `needs_input`.
- API fatal diagnostics include active session IDs and turn IDs.
- Fatal diagnostics do not install an `uncaughtException` handler and therefore do not keep a corrupted process alive.
- `npm test`, `npm run lint`, and `npm run build` pass.
