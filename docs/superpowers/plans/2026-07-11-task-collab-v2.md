# Task Collaboration Tools v2 Implementation Plan

## Goal

Move `selfExecute` from `studio.task.create` to `studio.task.createSimple`, and ensure both tools derive `projectId` exclusively from tool context.

## Checklist

1. Update tests for the two public schemas and both `createSimple` execution modes.
2. Reduce `task.create` to draft task creation only.
3. Add the self-execution path to `createSimpleTask` without dispatching a prompt.
4. Update tool handlers and builtin seed schemas to match the v2 design.
5. Run targeted tests, TypeScript checks, the full Vitest suite, build, lint, and `git diff --check`.
6. Commit on `worktree-task-collab-v2` and request formal code review before merging to `prd`.

## Acceptance

- `task.create` exposes only `title` and `description`, creates no steps, and remains `draft`.
- `task.createSimple(selfExecute=true)` uses the current Agent/session, creates one running step, and sends no prompt.
- `task.createSimple(selfExecute=false)` requires an assignee and retains the existing dispatch behavior.
- Neither tool exposes or accepts `projectId` from model input.
- Required verification commands pass.
