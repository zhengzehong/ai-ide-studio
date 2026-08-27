# Existing Agent System Prompt Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to edit the system prompt of an existing project Agent from the PC settings dialog and apply it on the next turn without interrupting active work.

**Architecture:** Reuse the existing `agents.update` contract and persistence path. Add the missing PC field and preserve empty-string clearing semantics. Include the effective session meta in embedded Runtime context invalidation so process and embedded modes both refresh an existing ACP Session on the next turn.

**Tech Stack:** React 19, TypeScript, ACP Runtime, Vitest.

**Spec:** Approved in chat on 2026-08-27.

## Global Constraints

- Do not add a database migration or a new RPC.
- Do not restart or otherwise affect the PRD service.
- Do not interrupt an active turn when settings are saved.
- Preserve existing Session history; refresh through ACP resume/load on the next turn.
- Keep the change PC-only; mobile editing is outside this task.

---

### Task 1: PC Agent Settings

**Files:**
- Modify: `ui/src/components/agent/AgentSettingsModal.tsx`
- Test: `tests/unit/agent-settings-system-prompt-pc.test.ts`

- [x] Write a failing component contract test for loading, editing, clearing, and saving `systemPrompt`.
- [x] Run the focused test and confirm it fails because the field is absent.
- [x] Add the textarea, explanatory next-turn copy, and save payload.
- [x] Run the focused test and confirm it passes.

### Task 2: Embedded Runtime Refresh Consistency

**Files:**
- Modify: `src/acp/host-types.ts`
- Modify: `src/acp/host-state.ts`
- Modify: `src/runtime/api/embedded-runtime-port.ts`
- Test: `tests/unit/acp-host-state.test.ts`

- [x] Write a failing test proving different Session meta produces a different embedded context key.
- [x] Run the focused test and confirm the current project/cwd-only key fails it.
- [x] Add a serializable Session context fingerprint derived from the Runtime snapshot and include it in the embedded key.
- [x] Run the focused test and confirm it passes.

### Task 3: Documentation And Verification

**Files:**
- Modify: `docs/architecture/project-agent-workflow.md`

- [x] Document that deployed Agents own an independent prompt snapshot and edits apply from the next turn.
- [x] Run focused tests, `npm test`, `npm run build`, `npm run lint`, TypeScript checks, and `git diff --check`.
- [x] Review the final diff for unrelated changes and runtime interruption risk.
- [ ] Commit one feature commit and merge it into `prd` without restarting services.
