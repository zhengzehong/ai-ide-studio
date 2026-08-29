# Unified Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone PC workbench that combines global dynamic/pinned sessions, an isolated conversation view, and an always-visible artifact preview panel.

**Architecture:** Add a global `/updates` route and compose existing `widget.sessionActivity.list`, `sessionDock.list`, `sessions.messages`, WebSocket subscriptions, and `fs.read` from a new page-local store. Do not extract or modify `Workspace.tsx`; the new conversation surface reuses stable chat/presentation components while keeping selected session state local to the workbench.

**Tech Stack:** React 19, React Router, Zustand, existing WebSocket/query clients, existing Markdown and presentation components, CSS variables.

**Spec:** `docs/design/unified-workbench-final.md` plus the clarified three-column behavior from the user conversation.

## Global Constraints

- Keep `Workspace.tsx` behavior and source untouched.
- No backend endpoint, database migration, or APP changes.
- Dynamic list means running/unread sessions from the existing global widget projection.
- Pinned list uses the existing global session dock.
- Cross-project selection must not change the global project/session selection used by Workspace.
- All user-visible text is Chinese; no `any`; components stay below 300 lines.

---

### Task 1: Workbench session adapter

**Files:**
- Create: `ui/src/stores/workbench-session.store.ts`
- Test: `tests/unit/workbench-session-store.test.ts`

- [x] Define local selected session, messages, loading/error state, and actions for loading `sessions.messages`, subscribing/unsubscribing one session, marking it read, and clearing state on unmount.
- [x] Keep all requests keyed by `sessionId`; do not call `useSessionStore.selectSession` or mutate the project store.
- [x] Add tests for selection race cancellation, read acknowledgement, and subscription cleanup.

### Task 2: Workbench sidebar

**Files:**
- Create: `ui/src/pages/UpdatesSidebar.tsx`
- Create: `ui/src/pages/updates/updates-sidebar.css`
- Test: `tests/unit/workbench-sidebar.test.tsx`

- [x] Load dynamic groups from `useWidgetStore` and pinned items from `useSessionDockStore`.
- [x] Render project/agent ownership, compact one-line session rows, running/unread indicators, loading/error/empty states, and a refresh action.
- [x] Exclude sessions already visible in dynamic from the pinned subsection while preserving the pinned badge.
- [x] Emit a selected session callback containing both `sessionId` and `projectId`.

### Task 3: Conversation and preview columns

**Files:**
- Create: `ui/src/pages/UpdatesConversation.tsx`
- Create: `ui/src/pages/UpdatesPreviewPanel.tsx`
- Create: `ui/src/pages/updates/updates-content.css`
- Test: `tests/unit/workbench-content.test.tsx`

- [x] Compose existing `VirtualChatList` and `MarkdownRenderer` with the existing message/presentation types without changing Workspace components.
- [x] Show an empty state until a session is selected, then load messages and display the selected session's latest reply.
- [x] Recover and respond to pending permission and elicitation requests so the standalone conversation cannot stall without an interaction surface.
- [x] Render preview/file presentations in the right rail without a modal; provide file tabs and a collapse control.
- [x] Preserve current selected session while background events refresh sidebar data.

### Task 4: Route, navigation, and integration tests

**Files:**
- Modify: `ui/src/routes/lazy-pages.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/layout/AppLayout.tsx`
- Create: `ui/src/pages/UpdatesPage.tsx`
- Create: `ui/src/pages/updates/updates-page.css`
- Test: `tests/unit/workbench-page.test.tsx`

- [x] Register lazy page and global `/updates` route beside `/pinned`.
- [x] Add a global navigation entry without changing project-scoped navigation.
- [x] Compose the three columns with responsive rail collapse and stable minimum widths.
- [x] Add integration-style tests for cross-project selection, read acknowledgement, pinned fallback, duplicate removal, subscription cleanup, and no Workspace selection mutation.

### Task 5: Verification and delivery

- [x] Run targeted workbench tests.
- [x] Run the non-baseline-failing full suite, `npm run lint`, `npm run build`, and `git diff --check`.
- [x] Review the diff for Workspace/backend/APP changes and confirm none are present.
- [x] Commit the feature branch and merge it into `prd` without restarting the PRD service.
