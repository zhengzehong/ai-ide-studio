# Tool Context Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Hide system-owned context fields from MCP tool schemas and make handlers trust session/tool context over model-provided identity or scope fields.

**Architecture:** Add a runtime schema sanitizer so MCP only exposes business parameters to models. Keep handlers defensive by deriving project/team/member/leader identity from `ToolContext` when present and validating cross-project target IDs.

**Tech Stack:** TypeScript, Vitest, MCP HTTP runtime, existing tool registry and SQLite stores.

---

### Task 1: Lock schema visibility with failing tests

**Files:**
- Modify: `tests/unit/tool-gateway-resolver.test.ts`
- Modify: `tests/unit/team-tool-handlers.test.ts`

- [x] Add tests that `listRuntimeTools()` hides `projectId`, `fromMemberId`, `teamId` when context already owns those fields.
- [x] Add tests that `team.create` ignores model-provided `projectId` and derives leader from `context.agentId`.
- [x] Add tests that `core.agent.create`, `core.task.create`, and `core.session.create` cannot target another project when current project context exists.
- [x] Run targeted tests and verify they fail before implementation.

### Task 2: Implement runtime schema sanitizer

**Files:**
- Create: `src/tools/runtime/schema-sanitizer.ts`
- Modify: `src/tools/runtime/tool-runtime.ts`

- [x] Add a helper that deep-clones JSON-schema-like objects and removes system-owned properties.
- [x] Always remove `fromMemberId`, `leaderAgentId`, `teamMemberId`, `sessionId`.
- [x] Remove `projectId` when `context.projectId` exists.
- [x] Remove `teamId` when `context.teamId` exists.
- [x] Remove `assigneeMemberId` from `team.task.update` for non-leader Team members.
- [x] Make `listRuntimeTools()` expose sanitized schemas.

### Task 3: Make handlers context-first and validate target IDs

**Files:**
- Modify: `src/tools/handlers/team/team-tools.ts`
- Modify: `src/tools/handlers/core/agent-tools.ts`
- Modify: `src/tools/handlers/core/session-tools.ts`
- Modify: `src/tools/handlers/create-task.ts`
- Modify: `src/tools/handlers/list-tasks.ts`
- Modify: `src/core/tasks.ts`

- [x] `team.create` uses `context.projectId` and `context.agentId`; do not use model-provided leader identity.
- [x] `team.mailbox.send` uses `context.teamMemberId` when available and rejects spoofing.
- [x] Project-scoped core tools use `context.projectId` over input `projectId`.
- [x] Validate `assignAgentId` / `agentId` targets belong to the current project before creating sessions or assigned tasks.

### Task 4: Verify real and automated behavior

**Files:**
- No production files expected.

- [x] Run targeted unit tests.
- [x] Run real simple Team smoke with Claude leader + Codex worker.
- [x] Run real complex Team smoke with Claude leader + two Codex members.
- [x] Run `npm test`, `npm run build`, `npm run lint`, `git diff --check`.
