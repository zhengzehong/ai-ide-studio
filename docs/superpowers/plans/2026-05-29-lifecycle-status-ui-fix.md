# Lifecycle status UI fix

## Goal

Fix two conversation UI issues:

1. Idle session disconnect lifecycle events must not create a visible assistant reply bubble or make the turn look stoppable/running.
2. Streaming status should show only one spinner/status indicator. The message header should display the stage text (connecting/resuming/generating), while the bubble body should not render a second spinner-only card.

## Scope

- Frontend session event reducer and live session store handling for lifecycle events.
- Workspace chat bubble/header rendering for streaming stage text.
- Backend lifecycle event choice only if needed.

## Steps

1. Inspect lifecycle event handling in ui/src/stores/session-events.ts, ui/src/stores/session.store.ts, and ui/src/pages/Workspace.tsx.
2. Treat lifecycle.session_disconnected as metadata/stage-only history, not an active streaming message.
3. Keep visible pending stages only for active prompt phases: runtime starting, session creating/resuming, prompt sent, failed while active.
4. Move active stage text to the existing header status beside generating; avoid rendering a second spinner bubble when there is no content/thinking/tool call.
5. Run focused tests and lint/build if touched types require it.
