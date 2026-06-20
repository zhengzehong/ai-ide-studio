# Knowledge Base LLM Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-KB LLM Wiki for humans and AI with markdown pages, wikilinks, shared mounts, direct `core.kb.*` writes, activity-based revert, and code-page stale detection.

**Architecture:** Add four SQLite-backed entities (`knowledge_bases`, `knowledge_pages`, `knowledge_mounts`, `knowledge_activities`) behind focused stores and `core/knowledge-base.ts`. Expose the same service through WS RPC for the UI and MCP `core.kb.*` tools for agents. Keep code refresh explicit: stale detection marks pages only; humans or agents trigger refresh writes.

**Tech Stack:** TypeScript, better-sqlite3 migrations/stores, Hono/WS RPC, MCP tool handlers, React 19, Zustand, ReactMarkdown-compatible wikilink rendering, Vitest.

---

### Task 1: Data Model And Service

**Files:**
- Create: `src/store/migrations/021-knowledge-base.ts`
- Modify: `src/store/migrations/index.ts`
- Create: `src/store/knowledge-bases.ts`
- Create: `src/store/knowledge-pages.ts`
- Create: `src/store/knowledge-mounts.ts`
- Create: `src/store/knowledge-activities.ts`
- Create: `src/core/knowledge-base.ts`
- Test: `tests/unit/knowledge-base-service.test.ts`

- [x] Write failing service tests for project KB creation, shared mounts, page links/backlinks, write activity, revert, and stale detection.
- [x] Add migration and stores with no foreign keys and soft references.
- [x] Implement `knowledgeBaseService` with lazy project KB ensure, visibility checks, wikilink parsing, activity snapshots, revert, and fingerprint stale checks.
- [x] Run `npm test -- tests/unit/knowledge-base-service.test.ts`.

### Task 2: MCP Tools

**Files:**
- Create: `src/tools/handlers/core/kb-tools.ts`
- Modify: `src/tools/handlers/core/index.ts`
- Modify: `src/tools/handlers/index.ts`
- Create: `src/tools/kb-seed.ts`
- Modify: `src/tools/seed.ts`
- Test: `tests/unit/kb-tool-handlers.test.ts`
- Test: `tests/unit/tool-seed.test.ts`

- [x] Write failing tool handler tests for `core.kb.list/read_index/read_page/search/create_page/update_page/refresh_from_code/create_kb/mount/unmount/revert`.
- [x] Register handlers and seed definitions with project context hidden by runtime schema sanitizer.
- [x] Run `npm test -- tests/unit/kb-tool-handlers.test.ts tests/unit/tool-seed.test.ts`.

### Task 3: WS RPC And Frontend Browse

**Files:**
- Create: `src/gateway/rpc/knowledge-base.ts`
- Modify: `src/gateway/rpc/registry.ts`
- Modify: `src/types/ws-protocol.ts`
- Create: `ui/src/stores/knowledge-base.store.ts`
- Create: `ui/src/pages/KnowledgeBase.tsx`
- Create: `ui/src/pages/knowledge-base/*`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/layout/AppLayout.tsx`

- [x] Add WS RPC methods for listing KBs/pages, reading/searching pages, and listing activities.
- [x] Add Zustand store and Knowledge Base route with left KB panel, page tree, document view, mounts bar, stale banner, wikilinks, and backlinks.
- [x] Run `npm run build -w ui`.

### Task 4: Writes, Activity Log, And Revert UI

**Files:**
- Modify: `src/gateway/rpc/knowledge-base.ts`
- Modify: `ui/src/pages/knowledge-base/*`
- Modify: `ui/src/stores/knowledge-base.store.ts`

- [x] Add RPC paths for create KB/page, update page, mount/unmount, and revert.
- [x] Implement edit mode, create KB modal, shared mount actions, activity side panel, and revert confirmation.
- [x] Run targeted backend tests and `npm run build -w ui`.

### Task 5: Code Stale Detection And Final Verification

**Files:**
- Modify: `src/core/knowledge-base.ts`
- Modify: `ui/src/pages/knowledge-base/*`
- Modify: docs architecture files as needed.

- [x] Hook lazy stale scanning into read/list paths and `refresh_from_code` into UI flow.
- [x] Update `docs/architecture/data-model.md`, `docs/architecture/mcp-tool-platform.md`, and `docs/architecture/ws-protocol.md`.
- [x] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
