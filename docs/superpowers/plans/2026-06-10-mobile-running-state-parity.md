# Mobile Running State Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align mobile session-list running/unread indicators and running-chat rendering with the PC behavior.

**Architecture:** Keep the change in the mobile frontend. Add small pure helpers for session card presentation and elapsed-time derivation, then wire those helpers into the existing mobile components without changing backend RPC shape.

**Tech Stack:** React 19, TypeScript 6, Zustand, Vitest, existing desktop shared chat/session types.

---

### Task 1: Mobile Session Indicator Rules

**Files:**
- Create: `mobile/src/utils/session-indicator.ts`
- Modify: `mobile/src/components/SessionCard.tsx`
- Test: `tests/unit/mobile-session-indicator.test.ts`

- [x] **Step 1: Write failing tests**

Cover running priority, unread yellow state, and idle sessions with stale running stage text.

- [x] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/unit/mobile-session-indicator.test.ts`

- [x] **Step 3: Implement helper and card wiring**

Expose `mobileSessionIndicator(session)` returning `color`, `pulse`, `title`, and `label`.

- [x] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/unit/mobile-session-indicator.test.ts`

### Task 2: Running Chat Elapsed Time

**Files:**
- Create: `mobile/src/utils/chat-elapsed.ts`
- Modify: `mobile/src/pages/ChatPage.tsx`
- Modify: `mobile/src/components/chat/TurnContent.tsx`
- Test: `tests/unit/mobile-chat-elapsed.test.ts`

- [x] **Step 1: Write failing tests**

Cover deriving running elapsed seconds from the latest human message timestamp and ignoring invalid/non-running inputs.

- [x] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/unit/mobile-chat-elapsed.test.ts`

- [x] **Step 3: Implement helper and pass elapsed to TurnContent**

Use a lightweight interval while `isRunning` so the running timer updates after re-entering a running chat.

- [x] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/unit/mobile-chat-elapsed.test.ts`

### Task 3: Running Process Default Open

**Files:**
- Modify: `mobile/src/components/chat/TurnContent.tsx`
- Test: `tests/unit/mobile-turn-content-state.test.ts`

- [x] **Step 1: Write failing tests**

Cover streaming process default-open behavior and completed message default-closed behavior through an exported pure helper.

- [x] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/unit/mobile-turn-content-state.test.ts`

- [x] **Step 3: Implement default-open state**

Match PC behavior: running/streaming execution process opens by default, completed historical process stays collapsed until tapped.

- [x] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/unit/mobile-turn-content-state.test.ts`

### Task 4: Verification and Review

**Files:**
- Review all changed files.

- [x] **Step 1: Run targeted tests**

Run: `npm test -- tests/unit/mobile-session-indicator.test.ts tests/unit/mobile-chat-elapsed.test.ts tests/unit/mobile-turn-content-state.test.ts tests/unit/mobile-chat-store.test.ts tests/unit/mobile-session-store.test.ts`

- [x] **Step 2: Run project checks**

Run: `npm run lint`

Run: `npm run build`

Run: `npm test`

- [x] **Step 3: Inspect diff**

Run: `git diff --check`

Run: `git diff --stat`

- [ ] **Step 4: Commit on prd branch**

Commit only this task's files and leave pre-existing untracked Excel files untouched.
