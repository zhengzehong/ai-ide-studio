# Knowledge Base Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blocking Knowledge Base review issues without expanding the feature scope.

**Architecture:** Keep the UI fix local to the Knowledge Base page and document component, using the existing Zustand store error channel plus a local operation error. Add handler-level project membership validation before KB write operations while keeping SQL visibility checks as the deeper isolation layer.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest, SQLite-backed tool handler tests.

---

### Task 1: Add Tool Handler Defense Test

**Files:**
- Modify: `tests/unit/kb-tool-handlers.test.ts`

- [ ] Add a failing test that creates two projects, a real agent in project A, then attempts a KB write in project B with that agent in `ToolContext`.
- [ ] Run `npx vitest run tests/unit/kb-tool-handlers.test.ts -t "rejects cross-project"` and confirm it fails before implementation.

### Task 2: Add KB Write Project Validation

**Files:**
- Modify: `src/tools/handlers/core/kb-tools.ts`

- [ ] Import `agentStore`.
- [ ] Add a local `assertAgentInProject(context.agentId, projectId)` helper matching the existing project mismatch behavior in other modules.
- [ ] Call it for each KB write handler: create page, update page, refresh from code, create KB, mount, unmount, revert.
- [ ] Re-run the focused handler test and confirm it passes.

### Task 3: Fix UI Error Handling

**Files:**
- Modify: `ui/src/pages/KnowledgeBase.tsx`
- Modify: `ui/src/stores/knowledge-base.store.ts`

- [ ] Add `clearError()` to the store.
- [ ] Catch save failures, keep `editing` and `form` unchanged, and show a visible message that the draft is retained.
- [ ] Catch create-page and refresh-with-agent failures and show visible error feedback.
- [ ] Add a close button for the error banner.

### Task 4: Add Saving Feedback

**Files:**
- Modify: `ui/src/pages/knowledge-base/KnowledgeDocument.tsx`
- Modify: `ui/src/pages/knowledge-base/knowledge-base.css`

- [ ] Show a spinner and `保存中` label while `saving` is true.
- [ ] Keep disabled-state behavior unchanged.

### Task 5: Verify

**Commands:**
- `npx vitest run tests/unit/kb-tool-handlers.test.ts`
- `npm test -- tests/unit/knowledge-base-service.test.ts tests/unit/knowledge-base-rpc.test.ts tests/unit/kb-tool-handlers.test.ts tests/unit/tool-seed.test.ts tests/unit/tool-gateway-resolver.test.ts tests/integration/sqlite-migration.test.ts`
- `npm run build`
- `npm run lint`
- `npx vitest run --no-file-parallelism --maxWorkers=1`
- `git diff --check`
