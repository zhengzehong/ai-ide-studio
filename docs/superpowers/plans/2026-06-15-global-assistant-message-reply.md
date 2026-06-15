# Global Assistant Message Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow project agents to send `agent.message.send` replies back to the configured global assistant without weakening normal project session isolation.

**Architecture:** Keep the exception inside `src/core/agent-session-communication.ts` target resolution only. A configured global assistant session or agent may be a message target from an explicit project context; other projectless sessions remain rejected. Message prompts sent to the global assistant carry the originating project context.

**Tech Stack:** TypeScript, Vitest, SQLite stores, existing session manager.

---

### Task 1: Add Regression Coverage

**Files:**
- Modify: `tests/unit/agent-session-communication.test.ts`

- [ ] **Step 1: Add failing tests**

Add service-level tests for:
- project agent sends to configured global assistant by `targetSessionId`
- project agent sends to configured global assistant by `targetAgentId`
- project agent cannot send to an arbitrary projectless session

- [ ] **Step 2: Run targeted RED check**

Run: `npm test -- tests/unit/agent-session-communication.test.ts`

Expected before implementation: the new global-assistant target tests fail with `会话不属于当前项目` or agent project validation errors.

### Task 2: Implement Narrow Target Exception

**Files:**
- Modify: `src/core/agent-session-communication.ts`

- [ ] **Step 1: Add target session helper**

Add a helper used only by `resolveTargetSession()` that accepts:
- sessions already visible in the source project
- the configured global assistant session when source project context exists

- [ ] **Step 2: Add target agent helper**

When only `targetAgentId` is provided, resolve the configured global assistant agent to its existing global assistant session. Keep normal project-agent session creation unchanged.

- [ ] **Step 3: Preserve project context on message prompt enqueue**

Pass `message.project_id` through `enqueueMessagePrompt()` into `sessionManager.enqueuePrompt(..., { contextProjectId })` when present.

### Task 3: Verify And Ship

**Files:**
- Review: `src/core/agent-session-communication.ts`
- Review: `tests/unit/agent-session-communication.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/unit/agent-session-communication.test.ts tests/unit/agent-session-tools.test.ts`

- [ ] **Step 2: Run required project checks**

Run: `npm test`
Run: `npm run lint`
Run: `npm run build`
Run: `git diff --check`

- [ ] **Step 3: Commit and update prd**

Commit only this task's files on `master`, then cherry-pick the commit into `D:\code_space\python_space\ai-ide-studio-prd` and push `prd`.
