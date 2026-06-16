# Session Dispatch Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify session targeting for event subscriptions, task creation, task assignment, and schedule rules.

**Architecture:** Keep the existing event subscription model as the reference. Add the same `existing` / `new_each` / `new_fixed` strategy to task and schedule flows while preserving old `sessionId` behavior. Store schedule strategy in `rules.action_config`, and use queued prompt dispatch when reusing sessions.

**Tech Stack:** TypeScript, Hono gateway RPC, better-sqlite3 stores, React/Zustand UI, Vitest.

---

### Task 1: Backend Session Mode Behavior

**Files:**
- Modify: `src/store/tasks.ts`
- Modify: `src/core/tasks.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Modify: `src/store/rules.ts`
- Modify: `src/core/rules.ts`
- Test: `tests/unit/task-rpc.test.ts`
- Test: `tests/unit/rules-session-reuse.test.ts`

- [x] Add `sessionMode?: 'existing' | 'new_each' | 'new_fixed'` to task creation and assignment inputs.
- [x] Preserve compatibility: existing `sessionId` without `sessionMode` means `existing`; no `sessionId` means `new_each`.
- [x] For schedule rules, store `action_config.session_mode` and write back `action_config.session_id` after the first `new_fixed` execution.
- [x] Use `enqueuePrompt` for reused/fixed sessions so prompts do not fail when a target session is active.

### Task 2: Tool Schema And Handler Exposure

**Files:**
- Modify: `src/tools/handlers/create-task.ts`
- Modify: `src/tools/handlers/studio-task-tools.ts`
- Modify: `src/tools/handlers/create-schedule.ts`
- Modify: `src/tools/handlers/schedule-tools.ts`
- Modify: `src/tools/seed.ts`
- Modify: `src/tools/event-center-seed.ts`
- Test: `tests/unit/core-tool-handlers.test.ts`
- Test: `tests/unit/tool-seed.test.ts`

- [x] Expose `sessionMode` and `sessionId` to task and schedule tools.
- [x] Expose `autoStart`, `consumerSessionMode`, and `consumerSessionId` to `event.subscription.create` seed schema.
- [x] Ensure handler schemas and stored tool seed schemas match.

### Task 3: Frontend Controls

**Files:**
- Modify: `ui/src/pages/event-center/SubscriptionCreateModal.tsx`
- Modify: `ui/src/pages/TaskBoard.tsx`
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/pages/Schedule.tsx`

- [x] Move subscription auto-start to the bottom with the enable checkbox.
- [x] Replace task session select with a three-mode control.
- [x] Replace schedule session select with a three-mode control for both `create_task` and `send_prompt`.
- [x] Send `sessionMode` and `sessionId` through WS payloads.

### Task 4: Verification And Integration

**Files:**
- Modify docs only if architecture or protocol references need syncing.

- [x] Run focused Vitest tests for task, rules, tool handlers, and tool seed.
- [x] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
- [ ] Commit only files changed for this request.
- [ ] Merge the commit into `prd` without carrying unrelated untracked files.
