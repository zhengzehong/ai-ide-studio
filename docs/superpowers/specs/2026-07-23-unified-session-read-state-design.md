# Unified Session Read State Design

## Goal

Make the PC Session indicator, Agent indicator, and active Project badge agree on running and unread state while preserving lightweight server summaries for inactive projects.

## Confirmed Failures

The current UI has two state paths. Session and Agent indicators use local maps, while Project badges use a cached server aggregate. The paths diverge because:

- `sessions.markRead` broadcasts `lastReadAt`, but PC Session data uses `last_read_at`.
- The Session list refresh unions unread IDs and never removes IDs that the server now reports as read.
- A visible Session is marked read when selected, but not after its final Agent message advances `last_message_at`.
- Project summaries rely on realtime invalidation without a periodic recovery path.
- The PC WebSocket has no heartbeat, so a half-open connection can remain displayed as connected.

## Source Of Truth

SQLite `sessions.last_message_at` and `sessions.last_read_at` remain the durable source of truth. The browser keeps two bounded overlays:

1. Activity transitions that occurred after a Session list request began.
2. Read acknowledgements that have been applied optimistically but are not yet visible in a server snapshot.

The overlays never invent a durable unread state. A later server snapshot confirms and removes optimistic read acknowledgements.

## Shared Indicator Model

Session rows and the local running/unread maps form one indicator index for the active project. A shared summarizer produces:

- Session state for each Session row.
- Agent counts by summarizing that Agent's Sessions.
- Active Project counts by summarizing all Sessions in the active project.

Inactive projects continue to use the server aggregate because downloading every Session for every project would undo the performance work. Realtime events and a 30-second stale refresh keep those summaries convergent.

## Read Reconciliation

A `SessionReadFence` stores per-Session transitions with monotonic revisions.

- `markRead(sessionId, readAt)` keeps a pending acknowledgement until a server row or canonical `session:changed` event has `last_read_at >= readAt`.
- `markUnread(sessionId)` records a background completion that happened after a list request checkpoint.
- A list response first removes prior unread entries for Sessions in that response, derives unread from timestamps, and then applies newer transitions.
- The current Session and running Sessions are never displayed as unread.

This replaces the current additive union and prevents delayed responses from resurrecting an old unread state.

## Visible Session Acknowledgement

Selecting a Session clears unread immediately, patches every cached copy with an optimistic `last_read_at`, and submits `sessions.markRead`.

When a current, visible Session receives `session:done`, the client acknowledges it again after the final message has been committed. A hidden tab does not consume the reply. When the document becomes visible again, the current Session is acknowledged if its timestamps or local overlay say it is unread.

Selecting the already-current Session remains cheap: it clears any erroneous local unread state without reloading messages. It submits another read acknowledgement only when the Session is actually unread.

## Realtime Recovery

The PC WebSocket sends a ping every 15 seconds. Any inbound frame, including pong, refreshes `lastInboundAt`. If no frame arrives for 30 seconds, the client closes the stale socket, reports disconnected, and schedules the existing reconnect flow.

Reconnect keeps the established order: listeners ready, subscriptions, cursor resume, HTTP recovery, then forced project stats refresh.

Project stats also refresh when the document becomes visible and every 30 seconds when stale. Realtime events remain the primary immediate path.

## Backend Contract

- `sessions.markRead` broadcasts `{ last_read_at: timestamp }`.
- Widget mark-read uses the same field.
- New Session inserts persist their initial `last_read_at` value.

No database migration is required because the column already exists.

## Testing

Regression tests cover:

- Canonical `last_read_at` broadcasts and new Session initialization.
- Server-read snapshots removing old local unread entries.
- Pending read acknowledgements fencing stale list responses.
- Background completion after a request checkpoint remaining unread.
- Current visible completion submitting a final read acknowledgement.
- Session, Agent, and active Project summaries using the same aggregation semantics.
- WebSocket ping, inbound activity, timeout reconnect, and timer cleanup.
- Project stats stale interval and visibility recovery.

## Scope

This change affects the PC UI and the shared backend read contract. Mobile behavior, database schema, message payloads, runtime ownership, and Session ordering are unchanged.
