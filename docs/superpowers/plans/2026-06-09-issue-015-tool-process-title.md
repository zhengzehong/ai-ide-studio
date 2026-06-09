# ISSUE-015 Tool Process Title Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Codex tool process items from regressing from readable command titles to `工具调用 #xxxxxx` after terminal output updates.

**Architecture:** Keep the existing tool-call merge semantics as the source of truth for process item updates. The first `tool.call` usually has the readable title and raw input; later `tool.update` events may only have a generic title plus output, so process persistence must merge instead of replacing the full detail.

**Tech Stack:** TypeScript, Vitest, better-sqlite3.

---

### Task 1: Regression Test

**Files:**
- Modify: `tests/integration/turn-process-items.test.ts`

- [x] **Step 1: Write the failing test**

Add an integration test that starts with a readable execute tool call, then stores a later update with a generic numbered title. Assert the persisted process item keeps the original title and raw input while accepting the completed status and raw output.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/turn-process-items.test.ts`

Expected before implementation: the new assertion fails because the title becomes `工具调用 #abc123`.

### Task 2: Minimal Implementation

**Files:**
- Modify: `src/core/turn-process-runtime.ts`

- [x] **Step 1: Merge tool updates before persisting process items**

In `upsertTool`, read the existing process item for the stable tool item id. If it has stored detail, parse it as `ToolCallData`, merge it with the incoming update using `mergeToolCall`, and persist the merged result.

- [x] **Step 2: Preserve existing fallback behavior**

If no existing detail is available or JSON parsing fails, persist the incoming tool call as before.

### Task 3: Verification And Commit

- [x] **Step 1: Run targeted tests**

Run: `npm test -- tests/integration/turn-process-items.test.ts tests/unit/tool-call-aggregation.test.ts`

- [x] **Step 2: Run broader validation**

Run: `npm test`

- [x] **Step 3: Commit only related files**

Commit the plan, regression test, and implementation. Do not include unrelated untracked files.
