# Event Category MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP tools for Agents to create and partially update event categories.

**Architecture:** Reuse the existing event category store and `eventCenterService.upsertCategory()`. Add only the MCP-facing seed definitions and handlers; keep delete/toggle out of scope for safety.

**Tech Stack:** TypeScript, Hono gateway, SQLite store, MCP builtin tool runtime, Vitest.

---

### Task 1: Tests

**Files:**
- Modify: `tests/unit/event-center-tools.test.ts`
- Modify: `tests/unit/tool-seed.test.ts`

- [ ] Add a unit test proving `event.category.create` creates a new enabled category and `event.category.update` changes only supplied fields.
- [ ] Add both tool names to the seeded builtin tool list expectation.
- [ ] Run `npm test -- tests/unit/event-center-tools.test.ts tests/unit/tool-seed.test.ts` and confirm the new tests fail because handlers/tools are missing.

### Task 2: MCP Tool Definitions

**Files:**
- Modify: `src/tools/event-center-seed.ts`
- Modify: `src/tools/handlers/event-center-tools.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] Add global builtin tool definitions for `event.category.create` and `event.category.update`.
- [ ] Add handlers that validate required string inputs.
- [ ] Implement create as create-only: fail if the category already exists.
- [ ] Implement update as partial update: fail if missing, preserve fields not provided, and merge through `upsertCategory()`.
- [ ] Register both handlers.

### Task 3: Documentation And Verification

**Files:**
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `docs/design/event-center.md`

- [ ] Document the two Agent-facing category tools.
- [ ] Run targeted tests, then `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
- [ ] Review staged diff to ensure only this feature is included before commit.
