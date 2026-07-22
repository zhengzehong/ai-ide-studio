# Session Activity Fence Design

## Problem

The project activity badge is server-derived, while Workspace agent and session indicators are derived from the PC session store. Realtime terminal events currently clear `runningSessionIds` but leave cached `SessionData.activity_state` unchanged. A later project activation or an older list response can therefore restore a completed session as running.

## Design

The session store will treat activity transitions as ordered local facts:

1. Record a monotonically increasing revision for each local or realtime `running`/`idle` transition.
2. Apply each transition to `runningSessionIds`, visible sessions, and every scoped session-list cache entry.
3. Capture the current revision when a session-list request starts.
4. Before committing its response, overlay only activity transitions newer than that request. This prevents an older response from rolling back a terminal event while allowing a later fresh request to remain authoritative.
5. Remove activity history when a session is deleted and reset it in test/store reset paths.

## Scope

- PC session store only.
- No protocol, backend, mobile, database, or migration changes.
- No change to project-level statistics.

## Verification

- An idle event patches cached activity so reactivating the project stays idle.
- A delayed list response reporting running cannot override a newer idle event.
- A later running event starts a new pulse normally.
- Existing session-store, project-cache, and full repository checks remain green.
