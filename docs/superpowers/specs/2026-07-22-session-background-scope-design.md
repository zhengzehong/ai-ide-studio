# Session Background Scope Isolation Design

## Problem

The Workspace can remain on project A while realtime recovery refreshes project B. The current
`fetchSessions` implementation treats every fetch as navigation: when the requested scope differs
from `activeSessionScope`, it replaces the visible `sessions`, loading state, and error state with
the requested scope. Workspace then filters project B data for project A and renders a false empty
Session list. Clicking an Agent cannot recover because Agent selection is a local action and does
not fetch Session data.

The previous cache-eviction fix only preserved an in-flight response after LRU payload eviction.
It did not establish a boundary between foreground activation and background fetching.

## Decision

Session scope activation and Session data fetching are separate operations:

- `activateProject(projectId)` is the only operation that may change `activeSessionScope`, visible
  `sessions`, and the visible loading/error state.
- `fetchSessions(agentId, projectId, options)` fetches and commits the requested cache scope. It may
  update visible state only when that scope is already active.
- A background fetch for an inactive project must update that project's cache without changing the
  current Workspace.
- Callers that intentionally enter a different visible scope must activate it explicitly before
  fetching. Dashboard activates the all-projects scope; the event subscription form activates its
  selected project scope.

This follows the existing Agent and Task store pattern, where `activateProject` controls visible
state and fetch methods are cache-aware background operations.

## Race Behavior

1. If A is active and background B succeeds, A remains visible with its current loading or
   refreshing state and B cache is refreshed.
2. If A is active and background B fails, A's loading/error state is unchanged and B retains its
   scoped cache error.
3. If B is fetched in the background and the user then activates B before completion, the existing
   in-flight request becomes B's loading source and its response fills the visible list.

## Scope

Modify only:

- `ui/src/stores/session.store.ts`
- `ui/src/pages/Dashboard.tsx`
- `ui/src/pages/event-center/SubscriptionCreateModal.tsx`
- focused Session project-cache tests and project documentation

No backend protocol, database schema, mobile behavior, Session ordering, or message-history logic
changes.

## Verification

- Regression tests for inactive background success and failure.
- Existing cache-eviction/in-flight reactivation test remains green.
- Full TypeScript, lint, build, and test suites.
- Independent code review before merging to `prd`.
