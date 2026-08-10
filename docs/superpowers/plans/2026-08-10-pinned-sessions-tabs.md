# Pinned Sessions Tabs

## Goal

Expose the existing cross-project Session Dock as a durable "Pinned Sessions" page on PC and as the first tab on mobile, while keeping the existing session list and quick Dock entry point.

## Scope

- Reuse `global_session_dock` and the existing `sessionDock.*` RPC contract.
- Keep pinned sessions global across projects, manually ordered, and persistent until explicitly unpinned.
- Add PC navigation and page-level management.
- Add mobile store/page/route and make it the first bottom tab; keep the normal session list as the second tab.
- Add pin/unpin actions from normal session surfaces where the current UI already exposes session actions.
- Preserve owner-only authorization and current stale-session pruning behavior.

## Implementation Steps

1. Add shared presentation helpers and PC page components for the pinned list, search/add picker, status filters, empty/loading/error states, open/unpin/reorder actions, and route/nav wiring.
2. Extend the existing session dock store only where page-level filters or refresh behavior require it; keep the drawer and page on the same store.
3. Add mobile pinned-session store/page using the same RPCs and types. Add the `/pinned` route and place it before `/` in `MobileShell` tabs. Keep deep-link chat navigation and reconnect refresh safe.
4. Add pin/unpin affordances to PC and mobile session rows/actions without changing delete/archive semantics.
5. Add focused unit/integration tests for route/tab order, empty state, pin/unpin, filtering, stale-event refresh, reorder, and owner/guest authorization.
6. Update stable architecture/usage documentation and run targeted tests, full tests, lint, typecheck, build, and diff checks.

## Defaults

- Candidate search is bounded to 50 entries per request; existing pins remain explicitly ordered.
- Sort: explicit manual pin order; activity/status only affect filters and badges.
- Opening a pinned session marks it read after navigation succeeds, but never unpins it.
- Empty mobile first tab links to the normal session list for adding pins.

## Acceptance Criteria

- PC and mobile show the same pinned sessions from the same server-side list.
- Mobile tab order is Pinned Sessions, Sessions, Tasks, Settings.
- Adding, removing, and reordering on either client is reflected after the existing realtime update event.
- Deleted/archived/non-conversation sessions do not remain pinned.
- No schedule/event `sessionMode` behavior changes.
- PRD worktree/service is not used during development or verification.
