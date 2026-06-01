# Team Tool Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Team MCP tools non-global by default, add Team tool visibility profiles, and expose Agent-level tool permission binding in the UI.

**Architecture:** Keep the existing method-level visibility model. `tools` defines platform methods, `tool_bindings` controls visibility at global/project/agent scope, and MCP tokens snapshot visible method names per session. Team permissions are profile presets that write concrete agent-level tool bindings; handlers still only validate business consistency.

**Tech Stack:** TypeScript, SQLite migrations, Vitest, Hono WS RPC, React/Zustand.

---

## Files

- Modify `src/tools/team-seed.ts`: make Team tools opt-in by default and attach profile metadata.
- Modify `src/tools/seed.ts`: skip default binding when a tool has no `defaultScope` and remove stale Team global bindings.
- Create `src/tools/team-profiles.ts`: define readonly/member/leader method sets and helper lookup.
- Modify `src/gateway/rpc/tools.ts`: add `tool-profiles.list` and `tool-profiles.apply` RPC handlers.
- Modify `ui/src/stores/tool.store.ts`: add profile RPC calls.
- Modify `ui/src/pages/AgentSquare.tsx` or current Agent editor component if present: add Agent tool permission panel.
- Modify `ui/src/pages/ToolManager.tsx`: keep existing low-level binding manager working; no broad redesign.
- Modify architecture docs: `docs/architecture/team-mcp-tools.md`, `docs/architecture/mcp-tool-platform.md`, `docs/architecture/ws-protocol.md`.
- Tests: `tests/unit/tool-seed.test.ts`, `tests/unit/tool-visibility-resolver.test.ts`, `tests/unit/tool-profiles.test.ts`, relevant UI build/lint.

## Tasks

### Task 1: Backend tests for Team tools not global

- [x] Add/adjust tests in `tests/unit/tool-seed.test.ts` so seeding builtins creates Team tool rows but does not create global bindings for `team.*`.
- [x] Add a visibility test proving a newly seeded Agent cannot see `team.create` until an agent-level binding exists.
- [x] Run `npm test -- tests/unit/tool-seed.test.ts tests/unit/tool-visibility-resolver.test.ts` and confirm the new tests fail before implementation.

### Task 2: Implement Team default visibility cleanup

- [x] Change `src/tools/team-seed.ts` so `TEAM_BUILTIN_TOOLS` do not carry `defaultScope: 'global'`.
- [x] Change `src/tools/seed.ts` so it only writes default bindings when `defaultScope` exists.
- [x] Add startup cleanup that deletes stale global `team.%` bindings from existing databases.
- [x] Run the Task 1 tests and confirm they pass.

### Task 3: Backend Team profiles

- [x] Create `src/tools/team-profiles.ts` with `team-readonly`, `team-member`, and `team-leader` profile definitions.
- [x] Add tests that profile application creates exact agent-level bindings and preserves non-Team bindings.
- [x] Add RPCs `tool-profiles.list` and `tool-profiles.apply` in `src/gateway/rpc/tools.ts`.
- [x] Run profile and visibility tests.

### Task 4: Frontend Agent tool permission UI

- [x] Add tool profile methods to `ui/src/stores/tool.store.ts`.
- [x] Add an Agent-level tool permission panel where users can select Team profile and toggle individual tools for an Agent.
- [x] Keep styling consistent with existing light theme and avoid broad layout changes.
- [x] Run `npm run build -w ui` and `npm run lint -w ui`.

### Task 5: Docs and full verification

- [x] Update architecture docs to state Team tools are opt-in and profile-driven.
- [x] Update WS protocol docs for new RPCs.
- [x] Run targeted tests, full `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
