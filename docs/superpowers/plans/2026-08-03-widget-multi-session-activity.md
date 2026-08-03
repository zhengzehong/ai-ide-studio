# Widget Multi-Session Activity Implementation Plan

## Goal

Replace the Widget's one-row-per-Agent representative Session model with a compact Agent-and-project grouped activity view. Every Session that is running, unread, or linked to a needs-input/blocked Task must remain individually visible in one fixed-height row.

## Interaction Contract

- Group by `agentId + projectId` and always show both the Agent and project name in the group header.
- Render each relevant Session on one line: state first, then Session title, a separator, directly linked Task title, and activity time.
- Keep running, unread, and needs-input as independent flags. A Session is included when any flag is true.
- Clicking a Session opens its exact project and Session. Mark only that Session read, and only after navigation succeeds.
- Default and filtered views never include completed, read Sessions.
- Footer counts Sessions rather than treating one Agent row as one activity.

## Steps

1. Add backend regression tests for multiple relevant Sessions under one Agent/project, cross-project grouping, direct Task association, independent state flags, ordering, project filtering, and result limits.
2. Add a dedicated Widget Session activity read model and RPC response while preserving existing Widget RPC compatibility.
3. Add frontend store tests for the grouped DTO, refresh events, exact Session read updates, filtering, and count behavior.
4. Replace the representative Agent row with small AgentProjectGroup and SessionActivityRow components matching the approved one-line prototype.
5. Update Widget styling and window dimensions so project attribution remains visible at the supported width.
6. Update Widget design, RPC, desktop packaging, and architecture documentation where required.
7. Run targeted tests, full tests, lint, server/UI/mobile build, Electron build, Playwright visual checks, and package smoke checks.
8. Commit in the worktree, obtain code-reviewer approval, merge into `prd`, and create NSIS plus portable Windows packages without restarting production services.

## Acceptance Criteria

- One Agent with multiple running/unread Sessions displays every relevant Session, not a representative subset.
- Each Session occupies exactly one row and begins with its state.
- Agent and project attribution are visible at the shipped Widget width.
- Task titles are only attached through direct Session/Task or Step/Task relations.
- Opening one Session never marks sibling Sessions read.
- `npm test`, `npm run lint`, `npm run build`, and Electron packaging pass.
- Code review approves the final commit before merge to `prd`.
