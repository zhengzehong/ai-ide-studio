# Chat Stream Render Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce chat streaming jank by isolating high-frequency chat updates from the Workspace shell and preserving stable render inputs for unchanged history and process blocks.

**Architecture:** Keep the change scoped to the existing chat stack. Move streaming-sensitive subscriptions and local input/menu/scroll state into a dedicated Workspace chat pane, memoize stable row components, and make turn updates preserve unchanged process block references. Backend, ACP, DB schema, and session cache contracts stay unchanged.

**Tech Stack:** React 19, Zustand, Vitest, TypeScript, existing `VirtualChatList`, existing chat render helpers.

---

### Task 1: Lock Performance Contracts

**Files:**
- Modify: `tests/unit/chat-render-items.test.ts`
- Create: `tests/unit/turn-blocks-reference.test.ts`

- [x] Add a failing test that `buildChatRenderItems` can reuse unchanged persisted message items across a streaming-only update.
- [x] Add a failing test that `applyTurnEntry` preserves unchanged process block object references when updating one later block.
- [x] Run the targeted tests and confirm they fail for the expected reasons.

### Task 2: Stabilize Render Inputs

**Files:**
- Modify: `ui/src/components/chat/render-items.ts`
- Modify: `ui/src/stores/turn-blocks.ts`

- [x] Add optional previous-item reuse in `buildChatRenderItems`.
- [x] Change turn block updates so only changed blocks get new object references.
- [x] Run the targeted tests and confirm they pass.

### Task 3: Isolate Workspace Streaming Renders

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`

- [x] Extract the center chat area into `WorkspaceChatPane`.
- [x] Move streaming-sensitive Zustand subscriptions into `WorkspaceChatPane`.
- [x] Keep `Workspace` subscribed only to shell-level state such as current session, agents, sessions, tasks, files, and team context.
- [x] Memoize chat row rendering units so unchanged history rows can skip re-render work.

### Task 4: Verify And Integrate

**Files:**
- Modify only files changed by Tasks 1-3.

- [x] Run targeted unit tests.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Review the diff for unrelated changes.
- [ ] Commit on `master`.
- [ ] Cherry-pick the commit into `D:\code_space\python_space\ai-ide-studio-prd`.
- [ ] Run verification on the prd worktree.
