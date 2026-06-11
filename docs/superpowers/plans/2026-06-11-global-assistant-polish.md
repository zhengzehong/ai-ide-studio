# Global Assistant Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the global assistant drawer layout, workspace directory strategy, and bottom toolbar menus.

**Architecture:** Keep the global assistant as a single reusable assistant, but make its UI participate in the app flex layout instead of overlaying the workspace. Generate a dedicated workspace per global assistant agent under an app-level assistant workspace root, using only `agentId/workspace`.

**Tech Stack:** Hono + SQLite backend, React + Zustand frontend, Vitest tests.

---

### Task 1: Workspace Directory Strategy

**Files:**
- Modify: `src/store/global-assistant.ts`
- Modify: `tests/integration/global-assistant-rpc.test.ts`

- [x] Add tests proving the default workspace is outside the DB directory and includes `agentId/workspace`.
- [x] Update `globalAssistantStore` to use `GLOBAL_ASSISTANT_WORKSPACE_ROOT` when set, otherwise an OS-level app data directory.
- [x] Stop reusing the previous assistant workspace when switching templates.

### Task 2: Right-Side Layout

**Files:**
- Modify: `ui/src/components/layout/AppLayout.css`
- Modify: `ui/src/components/global-assistant/GlobalAssistantRail.tsx`
- Modify: `ui/src/components/global-assistant/GlobalAssistantDrawer.tsx`

- [x] Remove the global assistant backdrop.
- [x] Render the drawer as a flex item before the rail.
- [x] Make the open drawer consume width and naturally shrink the main content.

### Task 3: Bottom Toolbar Menus

**Files:**
- Modify: `ui/src/components/global-assistant/GlobalAssistantControls.tsx`
- Modify: `ui/src/components/global-assistant/GlobalAssistantInput.tsx`

- [x] Render assistant dropdown menus through `createPortal(document.body)`.
- [x] Keep menu positioning based on button rects and above the input toolbar.
- [x] Preserve command, mode, model, and config behavior.

### Task 4: Verification And PRD Update

- [ ] Run focused global assistant tests.
- [ ] Run full test, lint, and build on `master`.
- [ ] Commit the fix on `master`.
- [ ] Cherry-pick the commit to the `prd` worktree.
- [ ] Run focused/full verification on `prd`.
