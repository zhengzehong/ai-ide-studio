# Global Assistant Agent Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the global assistant to use `agent.watch.*` and related agent-session communication tools within the currently selected project context.

**Architecture:** Keep the global assistant stored as a projectless agent/session, but allow that specific session to act inside an explicit prompt project context. Persist watches with the effective project id and pass that project id back when a watch wakes the global assistant session.

**Tech Stack:** TypeScript, Vitest, SQLite-backed stores, MCP tool runtime.

---

### Task 1: Regression Tests

**Files:**
- Modify: `tests/unit/agent-session-communication.test.ts`
- Modify: `tests/unit/agent-session-tools.test.ts`

- [x] Add a service test proving a configured global assistant can create a watch for a project session when the tool context includes `projectId`.
- [x] Add a service test proving a triggered watch enqueues the global assistant with `{ contextProjectId: watch.project_id }`.
- [x] Add a tool-handler test proving `agent.watch.create` accepts the same global assistant context through the MCP handler.
- [x] Run targeted tests and verify the new tests fail before implementation.

### Task 2: Implementation

**Files:**
- Modify: `src/core/agent-session-communication.ts`
- Modify: `src/core/sessions.ts`

- [x] In agent-session communication, allow `requireContextSession()` to accept a configured global assistant session even when `context.projectId` is set.
- [x] Keep watched target session validation project-scoped so the global assistant can only watch sessions in the active project context.
- [x] Extend queued prompt options so watch-triggered prompts can preserve `contextProjectId`.
- [x] Pass `watch.project_id` into `enqueuePrompt()` when waking the watcher session.

### Task 3: Verification and Sync

**Files:**
- Review changed files only.

- [x] Run targeted unit tests for agent-session communication/tools.
- [x] Run relevant global-assistant integration test.
- [x] Run `npm test` if targeted tests are clean.
- [x] Inspect `git diff --check` and scoped `git diff`.
- [ ] Commit only the files changed for this task on `master`.
- [ ] Cherry-pick the commit into `prd`, run targeted verification there, and push `prd`.
