# Reading Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one global reading library shared by PC and APP for AI-generated Markdown files, local HTML files, and HTTPS URLs.

**Architecture:** A single `reading_items` table stores lightweight metadata and source references. `reading.add` records the current project/session/Agent context; three RPCs list, fetch, and change state. Local files are served through a reading-specific route that reuses the Preview authentication and directory-mount behavior, while PC and APP keep separate presentation components over the same RPC contract.

**Tech Stack:** TypeScript, Hono, better-sqlite3, React 19, Zustand, React Router, React Markdown, Capacitor Browser, Vitest.

**Spec:** `docs/design/reading-feature-final.md`, with the confirmed scope overrides in this conversation.

## Global Constraints

- Work only on branch `feat/reading` in an isolated worktree; do not restart PRD services.
- Support `md`, `html`, and `url` in the first release.
- Only HTTPS URLs are accepted; external pages are embedded directly and always have an external-browser fallback.
- Add only one table: `reading_items`; file bodies and reading progress are not stored in SQLite.
- Do not add a `reading:update` WebSocket event; refresh on page entry, focus/foreground, and explicit refresh.
- Do not modify `Workspace.tsx` or existing Preview behavior.
- HTML and Markdown paths refer to the Gateway machine and use Preview-equivalent token/cookie, MIME, sandbox, and mounted-directory behavior.

---

### Task 1: Reading Persistence and Tool Contract

**Files:**
- Create: `src/store/migrations/059-reading-items.ts`
- Modify: `src/store/migrations/index.ts`
- Create: `src/store/reading-items.ts`
- Create: `src/tools/handlers/reading-add.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/seed.ts`
- Create: `tests/unit/reading-items.test.ts`
- Modify: `tests/unit/tool-seed.test.ts`

**Interfaces:**
- Produces `ReadingItemRow`, `ReadingItemFormat`, `ReadingItemStatus`, `readingItemStore`.
- Produces the global builtin tool `reading.add({ title, type, content })`.

- [ ] Write failing tests for migration shape, create/list/get/update, MD and HTML file registration, HTTPS URL registration, context injection, invalid extension/protocol, and exact tool schema.
- [ ] Run `npx vitest run tests/unit/reading-items.test.ts tests/unit/tool-seed.test.ts` and verify failures are caused by missing reading modules/tool.
- [ ] Implement migration `059`, Store validation/state transitions, summary extraction with bounded file reads, handler registration, and seed registration.
- [ ] Re-run the targeted tests and keep them green.

### Task 2: RPC and Local Reading Assets

**Files:**
- Create: `src/gateway/rpc/readings.ts`
- Modify: `src/gateway/rpc/registry.ts`
- Create: `src/gateway/reading-assets.ts`
- Create: `src/gateway/reading-auth.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/types/ws-protocol.ts`
- Create: `tests/unit/reading-rpc.test.ts`
- Create: `tests/integration/reading-assets.test.ts`

**Interfaces:**
- Produces RPCs `reading.list`, `reading.get`, and `reading.update`.
- Produces `GET /reading/:itemId/*` for MD/HTML mounted assets.

- [ ] Write failing RPC tests for active/archived lists, project/search filters, unread count, get, read/archive/restore transitions, and owner-only access.
- [ ] Write failing HTTP tests for token bootstrap, scoped reading cookie, relative CSS/image access, missing source, URL item rejection, and traversal rejection.
- [ ] Run the two test files and verify expected failures.
- [ ] Implement DTO mapping, RPC handlers, reading asset route, MIME handling, and Preview-equivalent authentication without changing Preview code.
- [ ] Re-run targeted RPC/HTTP tests.

### Task 3: Shared Frontend Reading Contract

**Files:**
- Create: `ui/src/types/reading.ts`
- Create: `ui/src/services/reading-client.ts`
- Create: `ui/src/services/reading-format.ts`
- Create: `tests/unit/reading-client.test.ts`

**Interfaces:**
- Produces `ReadingItem`, `ReadingListResult`, `ReadingFilter`, and client helpers used by PC and APP.
- Produces safe resource URL and source-session navigation helpers.

- [ ] Write failing tests for DTO normalization, local mounted URLs, HTTPS URL handling, search/filter parameters, and source-session workspace paths.
- [ ] Run `npx vitest run tests/unit/reading-client.test.ts` and verify expected failures.
- [ ] Implement the shared contract and helpers.
- [ ] Re-run the tests.

### Task 4: PC Reading Experience

**Files:**
- Create: `ui/src/pages/reading/ReadingPage.tsx`
- Create: `ui/src/pages/reading/ReadingListPanel.tsx`
- Create: `ui/src/pages/reading/ReadingCard.tsx`
- Create: `ui/src/pages/reading/ReadingReader.tsx`
- Create: `ui/src/pages/reading/ReadingMarkdown.tsx`
- Create: `ui/src/pages/reading/reading.css`
- Create: `ui/src/stores/reading.store.ts`
- Modify: `ui/src/routes/lazy-pages.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/layout/AppLayout.tsx`
- Create: `tests/unit/reading-pc-ui.test.tsx`

**Interfaces:**
- `/reading` is a global route with list/reader split layout.
- Store refreshes on mount/focus, marks opened items read, and supports archive/restore.

- [ ] Write failing component tests for loading/error/empty/data states, search/project filter, archive view, unread styling, Markdown rendering, local HTML iframe, URL iframe/external fallback, and source-session navigation.
- [ ] Run the PC UI tests and verify expected failures.
- [ ] Implement the route, sidebar entry, Store, components, responsive layout, local reading preferences, and focus refresh.
- [ ] Re-run PC UI tests.

### Task 5: APP Reading Experience

**Files:**
- Create: `mobile/src/pages/ReadingListPage.tsx`
- Create: `mobile/src/pages/ReadingDetailPage.tsx`
- Create: `mobile/src/components/reading/ReadingCard.tsx`
- Create: `mobile/src/components/reading/ReadingProjectSheet.tsx`
- Create: `mobile/src/components/reading/ReadingContent.tsx`
- Create: `mobile/src/stores/reading.store.ts`
- Modify: `mobile/src/App.tsx`
- Modify: `mobile/src/components/MobileShell.tsx`
- Modify: `mobile/src/components/AndroidBackHandler.tsx`
- Modify: `tests/unit/pinned-sessions-ui.test.ts`
- Create: `tests/unit/reading-mobile-ui.test.tsx`

**Interfaces:**
- Adds the fifth primary tab `/reading`.
- Adds full-screen `/reading/:itemId`; native URL fallback opens through `@capacitor/browser`.

- [ ] Write failing tests for five-tab order, unread badge, list/archive states, project sheet, Markdown/local HTML/URL rendering, server URL composition, external opening, and Android back behavior.
- [ ] Run mobile targeted tests and verify failures.
- [ ] Implement the APP Store, list/detail routes and components, foreground refresh, native Browser fallback, and five-tab responsive layout.
- [ ] Re-run mobile tests.

### Task 6: Documentation, Migration Validation, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/design/reading-feature-final.md`

- [ ] Update stable architecture and user-facing documentation; clarify no reading WS event and the Gateway-local path rule.
- [ ] Copy the PRD SQLite database to a temporary path and initialize it with migration `059`; verify schema and row preservation without touching the live DB.
- [ ] Run targeted reading tests.
- [ ] Run `npm test`, recording the pre-existing stale mobile-tab assertion if it remains relevant.
- [ ] Run `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Inspect every changed file, confirm component/backend file size limits, confirm `Workspace.tsx` and Preview behavior are unchanged, and commit the branch.
- [ ] Request independent code review; merge to `prd` only after approval and do not restart services.
