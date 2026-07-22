# Permission Interaction Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent historical approval cards from surviving completed turns, enforce full-access modes, and make expired interaction responses actionable.

**Architecture:** Keep Session recovery lightweight by applying the terminal-turn boundary in the event query. Make Runtime interaction cleanup emit the same result-shaped Session updates as user responses, and give frontend stores an explicit per-Session interaction error state.

**Tech Stack:** TypeScript, better-sqlite3, React 19, Zustand, Vitest.

---

### Task 1: Bound recovery interactions to the active turn

**Files:**
- Modify: `src/store/sessions.ts`
- Modify: `tests/integration/http-query-routes.test.ts`
- Modify: `tests/integration/query-transport-parity.test.ts`

- [ ] Add a failing integration case containing a historical `permission.request`, a later `message.done`, and a new active request.
- [ ] Verify the historical request currently appears in the recovery response.
- [ ] Update `eventStore.listRecovery` so interaction events must have a sequence greater than the latest `message.done` for the Session.
- [ ] Verify the active request remains recoverable and `latestSequence` still tracks the full event stream.

### Task 2: Complete Runtime interactions durably and enforce full-access modes

**Files:**
- Modify: `src/runtime/service/acp-runtime-client.ts`
- Modify: `src/runtime/service/sdk-runtime-host.ts`
- Modify: `tests/unit/acp-runtime-client.test.ts`
- Modify: `tests/unit/sdk-runtime-host-lifecycle.test.ts`

- [ ] Add failing tests that Session unbind publishes cancelled permission and elicitation result updates.
- [ ] Add failing tests that `bypassPermissions` and `agent-full-access` auto-select an allow option without publishing a permission request.
- [ ] Extend pending interactions with exactly-once cancellation callbacks used by timeout, cancel, unbind, and close.
- [ ] Track the desired permission mode in each Runtime binding and synchronize it on mode changes.
- [ ] Retain existing per-tool automatic approval for ordinary modes.

### Task 3: Remove expired cards and display actionable frontend errors

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/global-assistant.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/global-assistant/GlobalAssistantInput.tsx`
- Modify: `tests/unit/session-recovery-store.test.ts`
- Modify: `tests/unit/global-assistant-store.test.ts`

- [ ] Add failing store tests for an expired permission response.
- [ ] Add per-Session/per-assistant interaction error state.
- [ ] On the known expired error, remove only the matching request and set `权限请求已失效，请重新发送消息`.
- [ ] Clear the error on a new interaction or a successful response.
- [ ] Render the error in the existing composer status area without changing the interaction layout.

### Task 4: Verify, document, review, and merge

**Files:**
- Modify only documentation required by behavior changes.

- [ ] Run targeted tests and confirm the new tests pass after failing before implementation.
- [ ] Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, and `git diff --check`.
- [ ] Commit the isolated branch with a focused message.
- [ ] Request code review against the original `prd` base and address all P0/P1 findings.
- [ ] Merge the reviewed branch into `prd` with `--no-ff`, without restarting PRD.
