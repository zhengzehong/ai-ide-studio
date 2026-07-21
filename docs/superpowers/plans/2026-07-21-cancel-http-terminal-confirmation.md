# Cancel HTTP Terminal Confirmation Plan

## Goal

Ensure the PC workspace and global assistant leave the stopping state as soon as the HTTP cancel command succeeds, even when the matching realtime terminal event is delayed or missed.

## Root Cause

The Runtime cancel command already returns only after the active turn reaches a terminal state. The UI currently clears `stopping` and `running` only from `session:done` or idle activity events. If that realtime event is missed, the backend is stopped but the page remains stuck on "正在停止".

## Implementation

1. Add an `onSuccess` callback to the shared Session cancel coordinator and invoke it before resolving the shared cancel Promise.
2. In the PC Session store, use successful HTTP cancellation to clear stopping, running, streaming, and stale error state, then refresh persisted messages.
3. In the global assistant store, clear stopping, running, and streaming on successful HTTP cancellation, then refresh persisted messages.
4. Keep existing realtime terminal handlers as the primary event path and idempotent confirmation.

## Tests

1. Add regression assertions showing HTTP cancel success clears the PC Session state without emitting a realtime event.
2. Add the equivalent global assistant regression.
3. Verify the existing failure path still preserves running state and exposes the error.
4. Run targeted tests, full tests, lint, build, and `git diff --check`.

## Acceptance

- A successful cancel response removes "正在停止" without waiting for WebSocket delivery.
- The composer can accept the next Prompt immediately after the cancel response.
- Failed cancellation continues to show an error and retains the active turn.
- No server restart or `prd` merge occurs during implementation and review.
