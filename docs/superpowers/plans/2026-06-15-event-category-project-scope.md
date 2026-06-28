# Event Category Project Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind event categories to project scope while preserving global categories as fallbacks.

**Architecture:** Add `project_id` and `scope_key` to `event_categories`; store/service APIs resolve categories by current tool/session project context first and global scope second. MCP tools hide `projectId` and use `ToolContext.projectId`; the UI loads categories for the current project and labels project/global rows.

**Tech Stack:** TypeScript, better-sqlite3 migrations, Hono WS RPC, MCP builtin tools, React/Zustand, Vitest.

---

### Task 1: Scope Behavior Tests

**Files:**
- Modify: `tests/unit/event-center-service.test.ts`
- Modify: `tests/unit/event-center-tools.test.ts`
- Modify: `tests/integration/event-center-rpc.test.ts`
- Modify: `tests/integration/global-assistant-rpc.test.ts`

- [x] Add tests for global-only category listing, project listing with global fallback, project category overriding global category, and project isolation.
- [x] Add MCP tool tests proving `context.projectId` creates and updates project-scoped categories without exposing `projectId` input.
- [x] Add an RPC test proving `eventCategories.list/create/update` respect `projectId`.
- [x] Add or extend the global assistant project-context test so resolved MCP context contains the prompt `contextProjectId`.

### Task 2: Database And Store

**Files:**
- Create: `src/store/migrations/018-event-category-project-scope.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/event-categories.ts`
- Modify: `docs/architecture/data-model.md`

- [x] Add migration that rebuilds `event_categories` with `project_id`, `scope_key`, and `UNIQUE(scope_key, id)`.
- [x] Migrate existing category rows to global scope.
- [x] Update store row/input types and list/get/upsert/toggle/delete/reference count APIs to accept project scope.

### Task 3: Service, RPC, And MCP

**Files:**
- Modify: `src/core/event-center.ts`
- Modify: `src/gateway/rpc/event-center.ts`
- Modify: `src/tools/handlers/event-center-tools.ts`
- Modify: `src/tools/runtime/schema-sanitizer.ts`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/mcp-tool-platform.md`

- [x] Resolve event categories project-first, global-second when creating events and subscriptions.
- [x] Make event category RPCs accept `projectId`.
- [x] Make MCP category tools use `context.projectId` and hide project selection from Agent-facing schemas.
- [x] Keep global scope behavior for no-context global assistant calls.

### Task 4: Frontend

**Files:**
- Modify: `ui/src/stores/event-center.store.ts`
- Modify: `ui/src/pages/EventCenter.tsx`
- Modify: `ui/src/pages/event-center/CategoryPanel.tsx`
- Modify: `ui/src/pages/event-center/CategoryCreateModal.tsx`

- [x] Load categories with the current project ID.
- [x] Create/update/toggle/delete categories using the active project ID.
- [x] Display whether each category is project-scoped or global.
- [x] Prevent direct editing/deleting of global categories from a project page.

### Task 5: Verification

- [x] Run targeted tests for event center and global assistant.
- [x] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
- [x] Review staged diff for unrelated changes before commit.
