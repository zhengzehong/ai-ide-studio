# Session Draft Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep unsent Workspace text and image drafts isolated per session.

**Architecture:** Add a small frontend-only draft helper keyed by `sessionId`. `WorkspaceChatPane` keeps the active textarea state local, saves it into the helper when switching away, restores the target session draft when switching in, and clears only the current session draft after send.

**Tech Stack:** React 19, TypeScript, Vitest.

---

### Task 1: Draft Helper

**Files:**
- Create: `ui/src/pages/workspace/session-drafts.ts`
- Test: `tests/unit/workspace-session-drafts.test.ts`

- [x] Add tests for saving A draft, switching to empty B, then restoring A.
- [x] Add tests for clearing only the sent session draft.
- [x] Add tests for revoking image preview URLs when clearing or disposing drafts.
- [x] Implement `createSessionDraftStore()`.

### Task 2: Workspace Integration

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Replace shared draft behavior with session-keyed save/restore on `currentSessionId` changes.
- [x] Keep image upload/paste/drop attached to the session active when the file read started.
- [x] Clear only the current session draft after a successful send.
- [x] Dispose cached image previews when `WorkspaceChatPane` unmounts.

### Task 3: Verification And Sync

**Files:**
- Review all changed files.

- [x] Run `npx vitest run tests/unit/workspace-session-drafts.test.ts`.
- [x] Run `npm run lint` and `npm test`; `npm run build` is blocked in the current dirty worktree by unrelated untracked `ui/src/pages/event-center/EventCreateModal.tsx`, so repeat build validation in the `prd` worktree after sync.
- [x] Review `git diff --check` and staged diff.
- [ ] Commit the current branch.
- [ ] Cherry-pick/update the `prd` worktree and repeat targeted validation there.
