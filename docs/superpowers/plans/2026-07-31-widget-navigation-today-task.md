# Widget navigation and today's Agent task

## Goal

Keep the existing Widget glass opacity unchanged while refining control layout, eliminating full renderer reloads when opening an Agent, preserving the main window presentation state, and showing each Agent's latest task assigned today.

## Scope

1. Group every title-bar control except the brand mark on the right.
2. Reduce the footer status-cycle control without changing the Widget surface opacity or blur.
3. Route Widget navigation through the existing BrowserRouter renderer when it is ready; retain `loadURL` only as a recovery fallback.
4. Restore a minimized main window and reapply its tracked maximized/full-screen state.
5. Resolve today's latest task from both `tasks.assigned_agent_id` and `task_steps.assignee_agent_id`.
6. Do not render Session titles as Task links when no task was assigned today.
7. Merge to `prd` and build installer, portable, and unpacked artifacts without restarting PRD.

## Verification

- Navigation uses renderer IPC in the normal path and reloads only when the renderer is unavailable.
- Main-window restore preserves maximized and full-screen state.
- Top-level and step-assigned tasks are both returned; prior-day tasks are omitted.
- Agent rows without a task do not render a task icon or Session-title fallback.
- `npm test`, `npm run lint`, `npm run build`, `npm run build:electron:main`, and `git diff --check` pass.
- Packaged Widget resources contain the new layout and navigation bridge.
