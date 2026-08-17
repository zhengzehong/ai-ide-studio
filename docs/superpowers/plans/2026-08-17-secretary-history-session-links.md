# Secretary History And Session Links Implementation Plan

## Goal

Expose project secretary execution history and let PC/mobile users open the secretary runtime or chat Session in the existing conversation workspace. Secretary Sessions must remain hidden from ordinary Session lists.

## Scope

- Add a lightweight, owner-only secretary run history RPC.
- Refresh secretary clients when a run enters running or terminal state.
- Show recent runs and runtime/chat Session links on PC and mobile secretary pages.
- Deep-link hidden secretary Sessions into the existing PC Workspace and mobile Chat page.
- Remove the duplicate secretary chat overlay entry points.
- Update protocol/architecture documentation and focused tests.

## Steps

1. Add focused failing tests for recent-run ordering/limits, RPC project ownership, terminal update broadcasts, and hidden Session deep-link loading.
2. Add a bounded recent-run query and `secretary.runs.list` RPC without returning `payload_json`.
3. Emit `secretary:update` when a run is claimed and when it succeeds or fails.
4. Add a guarded `secretary.session.get` RPC that only returns the selected secretary's runtime/chat Session.
5. Extend PC and mobile Session stores with a method that temporarily loads one guarded secretary Session without exposing it in normal lists.
6. Replace embedded secretary chat overlays with Workspace/Chat navigation and add compact recent-run lists to both secretary pages.
7. Update WS protocol and architecture overview/README.
8. Run targeted tests, `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; review the final diff, commit, and merge into `prd` without restarting services.

## Acceptance Criteria

- Recent runs show pending/running/succeeded/failed, trigger, time, duration, and error summary.
- Run history is newest-first, bounded, project-scoped, and excludes `payload_json`.
- Run state changes appear without manual refresh.
- Runtime/chat links open the exact hidden Session in existing PC/mobile chat surfaces.
- Secretary Sessions remain absent from normal Session lists.
- Existing secretary mail, configuration, manual run, attachments, and ordinary Session behavior remain intact.
