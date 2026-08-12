# KB Minimal Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eleven Agent-visible KB tools with four minimal page tools: `core.kb.list`, `core.kb.read`, `core.kb.upsert`, and `core.kb.delete`.

**Architecture:** Keep the existing knowledge-base service and PC WS RPCs intact. Replace only the Agent tool seed and handler registration, add one explicit page soft-delete service operation, and derive project/actor identity exclusively from `ToolContext`.

**Tech Stack:** TypeScript, SQLite/better-sqlite3, built-in MCP tool registry, Vitest.

---

### Task 1: Define the new Agent contract

**Files:**
- Modify: `tests/unit/kb-tool-handlers.test.ts`
- Modify: `tests/unit/tool-seed.test.ts`

- [x] Add a failing test asserting only `list/read/upsert/delete` handlers are registered.
- [x] Add a failing test for lightweight list output and page create/update/read/delete.
- [x] Add seed assertions that schemas never expose `projectId` and legacy KB tools are obsolete.
- [x] Run `npx vitest run tests/unit/kb-tool-handlers.test.ts tests/unit/tool-seed.test.ts` and confirm the old implementation fails.

### Task 2: Implement page deletion and compact result mapping

**Files:**
- Modify: `src/core/knowledge-base.ts`
- Modify: `src/store/knowledge-activities.ts`
- Modify: `src/tools/handlers/core/kb-tools.ts`

- [x] Add `deletePage` to soft-delete a visible non-index page, record a delete activity, touch the KB, and emit `page.deleted`.
- [x] Map `list` results to KB metadata plus page metadata without body or internal snapshot fields.
- [x] Implement `read({pageId})`, `upsert`, and `delete({pageId})` using context-injected project and actor identities.
- [x] Make update upsert preserve omitted title/section/summary/body/tags by reading the current page before calling `updatePage`.

### Task 3: Replace Agent-visible tool definitions

**Files:**
- Modify: `src/tools/kb-seed.ts`
- Modify: `src/tools/handlers/core/index.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/seed.ts`

- [x] Define exactly four KB built-ins with minimal schemas and no `projectId`.
- [x] Register exactly four KB handlers.
- [x] Add legacy KB tool names to obsolete cleanup so tool rows, bindings, and cached contexts are removed on the next normal startup.
- [x] Preserve existing PC WS RPC handlers unchanged.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `README.md`
- Test: `tests/unit/kb-tool-handlers.test.ts`
- Test: `tests/unit/tool-seed.test.ts`

- [x] Document the four-tool page workflow and runtime-injected context.
- [x] Run targeted tests and confirm green.
- [x] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
- [x] Review the final diff for PC RPC compatibility, tool visibility, soft-delete safety, and no service restart.
