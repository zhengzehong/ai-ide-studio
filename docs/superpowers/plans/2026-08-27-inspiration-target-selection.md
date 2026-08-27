# Inspiration Task Target Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let project inspiration tasks choose an execution Agent and Session, with project defaults and a default-vs-recommended priority mode.

**Architecture:** Keep the existing inspiration organizer Agent/Session unchanged. Add nullable project-level execution defaults and a priority enum, pass explicit target selection through the existing task session modes, and validate ownership at the backend boundary.

**Tech Stack:** TypeScript, SQLite migrations, Hono WebSocket RPC, React, Zustand, Vitest.

**Spec:** Product discussion in the current session.

## Global Constraints

- Project defaults apply only to inspiration candidate task execution, not the organizer session.
- Priority is `default` or `recommended`; manual candidate selection always wins.
- Existing Session targets must belong to the current project and selected Agent and remain active.
- No changes to ordinary task creation behavior, ACP runtime, or PRD services.

---

### Task 1: Persist project execution defaults

**Files:**
- Create: `src/store/migrations/058-inspiration-task-target.ts`
- Modify: `src/store/project-inspirations.ts`
- Modify: `src/core/project-inspiration.ts`
- Modify: `src/gateway/rpc/inspiration.ts`
- Test: `tests/integration/project-inspiration.test.ts`

- [x] Add migration columns `task_default_agent_id`, `task_default_session_id`, and `task_target_priority` with `default` fallback.
- [x] Extend store row/data/update types and validate Agent/Session ownership and active status.
- [x] Extend `inspiration.configure` input and return data while preserving organizer fields.
- [x] Extend `createTaskFromInspirationCandidate` to accept `sessionId` and `sessionMode`, validate them, and pass them to `createSimpleTask`.
- [x] Add tests for persistence, ownership mismatch, invalid/closed sessions, and default fallback.

### Task 2: Candidate task target resolution

**Files:**
- Modify: `src/core/project-inspiration.ts`
- Modify: `src/store/inspiration-candidates.ts`
- Modify: `src/core/project-inspiration-view.ts`
- Modify: `src/gateway/rpc/inspiration.ts`
- Test: `tests/integration/project-inspiration.test.ts`

- [x] Resolve omitted candidate target as manual target, project default target, or AI `suggestedAgentId` according to priority.
- [x] Preserve explicit Agent/Session selection on candidate task creation and return the resulting execution Session.
- [x] Keep draft creation valid without starting a Session; retain selected Agent and target Session metadata for later validation.
- [x] Ensure no target resolves to a Session belonging to another Agent.

### Task 3: PC settings and candidate dialog

**Files:**
- Modify: `ui/src/stores/inspiration.store.ts`
- Modify: `ui/src/pages/Inspiration.tsx`
- Modify: `ui/src/pages/inspiration/InspirationSettingsDialog.tsx`
- Modify: `ui/src/pages/inspiration/CandidateTaskDialog.tsx`
- Modify: `ui/src/pages/inspiration/inspiration.css`
- Test: `tests/unit/inspiration-target-selection.test.ts`

- [x] Add project default Agent, Session, and priority controls to settings.
- [x] Filter Session options by selected Agent and provide `自动新建会话`.
- [x] Initialize candidate controls using manual value, then configured priority, then recommendation/fallback.
- [x] Submit `agentId`, `sessionId`, and `sessionMode`; show clear fallback/error when a default Session is no longer valid.
- [x] Add render/store tests for both priority modes and Agent/Session linkage.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/ws-protocol.md`

- [x] Document project inspiration execution defaults and target priority semantics.
- [x] Run focused tests, then `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- [x] Review the final diff and commit once before merging to `prd`.
