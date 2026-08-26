# ACP Session Materialization Recovery Plan

## Goal

Prevent an ACP Session created only for capabilities/configuration from becoming a stale persisted mapping after idle cleanup, and safely recover missing Claude/Codex runtime sessions before the first real prompt.

## Required Behavior

- `core.session.capabilities` and `core.session.configure` may create an in-memory Runtime Session, but must not persist a new `sessions.acp_session_id` for an otherwise empty platform Session.
- The first real prompt may reuse the in-memory Session or create a new one, then persist the returned ACP Session ID.
- A missing Claude Session or Codex Thread may be recreated exactly once only when the platform Session has no prior materialized Agent turn.
- A Session with prior runtime history must fail explicitly instead of silently losing model context.
- Recovery must happen before `RuntimePort.prompt`, so user messages and task dispatches are not duplicated.

## Implementation Steps

1. Extend the Runtime Session snapshot with an explicit missing-session recovery policy derived from durable message/process history.
2. Stop `session-runtime-control` from persisting ACP IDs created by capabilities/configuration calls.
3. Normalize runtime-specific missing-session errors for Claude and Codex.
4. Add a one-shot `resume/load -> newSession` fallback in the shared SDK Runtime Session opener when recovery is allowed.
5. Emit structured logs for recovery and preserve the existing mapping update in the real prompt path.
6. Add unit/integration coverage for empty Sessions, historical Sessions, unrelated errors, preferences, idle cleanup, and concurrent ensure calls.
7. Run `npm test`, `npm run build`, `npm run lint`, TypeScript checks, and `git diff --check`; review scope and merge to `prd`.

## Acceptance Criteria

- Empty configured Claude and Codex Sessions survive idle cleanup and service restarts without a terminal missing-session error on first prompt.
- Existing stale empty mappings self-heal once.
- Historical Sessions never silently reset when their native history is missing.
- No duplicate human message, prompt, task dispatch, or unbounded retry is possible.
- No database migration or frontend behavior change is required.
