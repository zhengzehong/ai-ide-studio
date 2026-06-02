# Chat Session Isolation Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix PRD workspace chat session switching so old chat content and old agent identity cannot remain visible after switching sessions.

**Architecture:** Keep the fix local to Workspace rendering and chat item composition. Derive the visible chat agent from the current session, filter render inputs by current session id, and remount the virtual chat list per session to clear measurement/DOM cache.

**Tech Stack:** React 19, Zustand, Vitest, TypeScript, existing Workspace and chat render helpers.

---

### Task 1: Guard chat render inputs by session

**Files:**
- Modify: `ui/src/components/chat/render-items.ts`
- Test: `tests/unit/chat-render-items.test.ts`

- [x] **Step 1: Write failing tests**
  - Add a test proving messages/events from other sessions are not rendered when `sessionId` is provided.

- [x] **Step 2: Run test and verify red**
  - Run: `npm test -- tests/unit/chat-render-items.test.ts`
  - Expected before implementation: FAIL because `sessionId` is ignored.

- [x] **Step 3: Implement minimal render filtering**
  - Add optional `sessionId` to `buildChatRenderItems` input.
  - Filter `messages`, `events`, and `streamingBubble` by `sessionId` before building items.

- [x] **Step 4: Run test and verify green**
  - Run: `npm test -- tests/unit/chat-render-items.test.ts`

### Task 2: Derive current chat agent from selected session

**Files:**
- Modify: `ui/src/pages/workspace/helpers.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/workspace-session-agent.test.ts`

- [x] **Step 1: Write failing helper test**
  - Add a pure helper that chooses current chat agent by `currentSessionId -> session.agent_id`, falling back to selected/default agent only when no current session exists.

- [x] **Step 2: Run test and verify red**
  - Run: `npm test -- tests/unit/workspace-session-agent.test.ts`
  - Expected before implementation: FAIL because helper does not exist.

- [x] **Step 3: Implement helper and use it in Workspace**
  - Export `selectChatAgent` from helpers.
  - Use it for header and `ChatBubble` agent prop.

- [x] **Step 4: Run test and verify green**
  - Run: `npm test -- tests/unit/workspace-session-agent.test.ts`

### Task 3: Remount virtual chat list per session

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`

- [x] **Step 1: Add session key**
  - Add `key={currentSessionId}` to `VirtualChatList`.

- [x] **Step 2: Verify with browser**
  - Open PRD page.
  - Click long code engineer session, then short code reviewer session.
  - Expected: only reviewer session message remains; no old code engineer tool blocks.

### Task 4: Full verification and PRD merge

**Files:**
- Commit current branch.
- Cherry-pick/merge to `D:\code_space\python_space\ai-ide-studio-prd`.

- [x] **Step 1: Run verification on master**
  - `npm test -- tests/unit/chat-render-items.test.ts tests/unit/workspace-session-agent.test.ts`
  - `npm run build`
  - `npm run lint`
  - `git diff --check`

- [ ] **Step 2: Commit master fix**
  - Commit message: `fix: isolate chat session rendering`

- [ ] **Step 3: Merge/cherry-pick to prd without touching unrelated PRD dirty files**
  - Preserve `scripts/start-prd-local.ps1` and its plan file.

- [ ] **Step 4: Run verification on prd and browser test**
  - Same test/build/lint checks.
  - Start PRD local instance if needed and manually verify switching.
