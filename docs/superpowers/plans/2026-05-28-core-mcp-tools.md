# Core MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the core platform MCP tools actually usable: project/agent/session/task list-get-create, plus cleanup of stale broken legacy tools.

**Architecture:** Keep the existing HTTP MCP/token visibility/runtime architecture. Add focused builtin handlers under `src/tools/handlers/core/`, make `seedBuiltinTools()` synchronize builtin tool definitions by name, and remove old builtin tool rows that no longer have handlers.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing tool runtime and stores.

---

## Scope

Implement only these core MCP tools:

- `core.project.list`
- `core.project.get`
- `core.project.create`
- `core.agent.list`
- `core.agent.get`
- `core.agent.create`
- `core.session.list`
- `core.session.get`
- `core.session.create`
- `core.task.list`
- `core.task.create`

Do not implement `admin.*`, `team.*`, update/delete/prompt tools in this pass.

## Tasks

### Task 1: Add failing tests for builtin seed synchronization

**Files:**
- Create: `tests/unit/tool-seed.test.ts`
- Modify later: `src/tools/seed.ts`

- [ ] Verify that an existing DB with stale builtin tools still gets all new core tools.
- [ ] Verify that obsolete stale tools (`get_project_info`, `search_files`, `list_agents`, `http_fetch`) are removed from `tools` and `tool_bindings`.
- [ ] Verify active `tool_contexts` containing stale tools are revoked.

### Task 2: Add failing tests for core handlers

**Files:**
- Create: `tests/unit/core-tool-handlers.test.ts`
- Create later: `src/tools/handlers/core/project-tools.ts`
- Create later: `src/tools/handlers/core/agent-tools.ts`
- Create later: `src/tools/handlers/core/session-tools.ts`

- [ ] Test project list/get/create.
- [ ] Test agent list/get/create using current context project when input omits projectId.
- [ ] Test session list/get/create using the store-backed create path.

### Task 3: Implement seed synchronization and stale cleanup

**Files:**
- Modify: `src/tools/seed.ts`

- [ ] Replace count-based seed guard with name-based upsert.
- [ ] Add all core tool definitions.
- [ ] Remove obsolete legacy broken tools and their bindings.
- [ ] Revoke existing tool contexts that include obsolete tools.

### Task 4: Implement core project/agent/session handlers

**Files:**
- Create: `src/tools/handlers/core/project-tools.ts`
- Create: `src/tools/handlers/core/agent-tools.ts`
- Create: `src/tools/handlers/core/session-tools.ts`
- Create: `src/tools/handlers/core/index.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] Add handlers with explicit input schemas.
- [ ] Register handlers in existing handler map.
- [ ] Keep outputs JSON text for MCP compatibility.

### Task 5: Validate and document

**Files:**
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `docs/architecture/tool-system.md`
- Modify: `README.md`

- [ ] Update the implemented core method list.
- [ ] Run targeted tests first.
- [ ] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
