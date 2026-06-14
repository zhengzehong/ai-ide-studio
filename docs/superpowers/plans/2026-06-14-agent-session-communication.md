# Agent Session Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement first-version non-Team Agent-to-Agent session messaging and watch using persisted business tables plus background `sessionManager.enqueuePrompt()`.

**Architecture:** Add focused stores for `agent_session_messages` and `agent_session_watches`, prompt builders, and tool handlers. Automatic delivery is fire-and-forget: records are persisted first, then `enqueuePrompt()` updates delivery status asynchronously. `session:done` drives one-time needReply reminders and watch triggers.

**Tech Stack:** TypeScript, Hono backend, better-sqlite3 migrations, MCP builtin tools, Vitest.

---

### Task 1: Database and Stores

**Files:**
- Create: `src/store/migrations/016-agent-session-communication.ts`
- Modify: `src/store/migrations/index.ts`
- Create: `src/store/agent-session-communication.ts`
- Test: `tests/integration/sqlite-migration.test.ts`
- Test: `tests/unit/agent-session-communication-store.test.ts`

- [x] Add migration for `agent_session_messages` and `agent_session_watches`.
- [x] Add store helpers for create/list/update/reminder/watch operations.
- [x] Verify migration exposes both tables and version `016`.

### Task 2: Prompt Builders and Service

**Files:**
- Create: `src/core/agent-session-prompts.ts`
- Create: `src/core/agent-session-communication.ts`
- Test: `tests/unit/agent-session-communication.test.ts`

- [x] Build prompt templates for normal message, needReply message, reminder, and watch trigger.
- [x] Implement `sendMessage()` with validation, target session creation, record persistence, and background `enqueuePrompt()`.
- [x] Implement `handleSessionDone()` for needReply reminders and watch triggers.
- [x] Implement watch create/cancel and session list/messages helpers.

### Task 3: Tool Registration

**Files:**
- Create: `src/tools/handlers/agent-session-tools.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/seed.ts`
- Test: `tests/unit/agent-session-tools.test.ts`

- [x] Register `agent.message.send`.
- [x] Register `agent.session.list`.
- [x] Register `agent.session.messages`.
- [x] Register `agent.watch.create`.
- [x] Register `agent.watch.cancel`.
- [x] Seed all five tools globally.

### Task 4: Verification and Commit

**Files:**
- Modify as needed from previous tasks only.

- [x] Run focused tests.
- [x] Run full `npm test` if focused tests pass.
- [x] Run `npm run build` and `npm run lint` if time permits.
- [x] Review `git diff` to ensure unrelated dirty files are not staged.
- [ ] Commit only files changed for this feature.
