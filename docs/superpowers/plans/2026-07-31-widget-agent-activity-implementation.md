# Widget Agent Activity Implementation Plan

## Goal

Replace the desktop Widget's Session/task tabs with a translucent, Agent-first activity list. Each Agent appears once, is ordered by recent activity, and shows at most two text lines with a directly linked Task when available.

## Steps

1. Add failing backend tests for Agent aggregation, representative Session priority, Task linkage, project filtering, and bounded results.
2. Add a dedicated Widget Agent activity read model and RPC without changing the legacy Widget RPCs.
3. Add failing frontend tests for activity loading, event-driven refresh, filtering, and navigation-before-read behavior.
4. Replace the Session/task tab UI with the approved two-line Agent activity layout.
5. Apply the translucent desktop treatment and update the Electron Widget dimensions.
6. Update RPC and architecture documentation.
7. Run targeted tests, full tests, lint, server/UI/mobile build, Electron build, visual verification, review, PRD merge, and EXE packaging.

## Acceptance

- Each Agent appears at most once and the list is ordered by latest activity.
- The representative Session prioritizes running, needs-input, unread, then recent activity.
- Direct `sessions.task_id` linkage supplies the Task title/status; unlinked Sessions fall back to Session activity text.
- Every Agent row remains exactly two text lines at the supported Widget width.
- Project/status filters work without another full-page mode.
- Clicking an Agent opens its representative Session and only marks it read after successful navigation.
- No database migration, PRD restart, PRD port binding, or production data mutation occurs.
