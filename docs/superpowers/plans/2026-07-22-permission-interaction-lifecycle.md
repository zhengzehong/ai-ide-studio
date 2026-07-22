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

- [x] Add a failing integration case containing a historical `permission.request`, a later `message.done`, and a new active request.
- [x] Verify the historical request currently appears in the recovery response.
- [x] Update `eventStore.listRecovery` so interaction events must have a sequence greater than the latest `message.done` for the Session.
- [x] Verify the active request remains recoverable and `latestSequence` still tracks the full event stream.

### Task 2: Complete Runtime interactions durably and enforce full-access modes

**Files:**
- Modify: `src/runtime/service/acp-runtime-client.ts`
- Modify: `src/runtime/service/sdk-runtime-host.ts`
- Modify: `tests/unit/acp-runtime-client.test.ts`
- Modify: `tests/unit/sdk-runtime-host-lifecycle.test.ts`

- [x] Add failing tests that Session unbind publishes cancelled permission and elicitation result updates.
- [x] Add failing tests that `bypassPermissions` and `agent-full-access` auto-select an allow option without publishing a permission request.
- [x] Extend pending interactions with exactly-once cancellation callbacks used by timeout, cancel, unbind, and close.
- [x] Track only the ACP-confirmed permission mode in each Runtime binding and synchronize it on successful mode/config changes.
- [x] Retain existing per-tool automatic approval for ordinary modes.

### Task 3: Remove expired cards and display actionable frontend errors

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/global-assistant.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/global-assistant/GlobalAssistantInput.tsx`
- Modify: `tests/unit/session-recovery-store.test.ts`
- Modify: `tests/unit/global-assistant-store.test.ts`

- [x] Add failing store tests for an expired permission response.
- [x] Add per-Session/per-assistant interaction error state.
- [x] On the known expired error, remove only the matching request and set `权限请求已失效，请重新发送消息`.
- [x] Clear the error on a new interaction or a successful response.
- [x] Render the error in the existing composer status area without changing the interaction layout.

### Task 4: Verify, document, review, and merge

**Files:**
- Modify only documentation required by behavior changes.

- [x] Run targeted tests and confirm the new tests pass after failing before implementation.
- [x] Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, and `git diff --check`.
- [x] Commit the isolated branch with focused messages.
- [ ] Request code review against the original `prd` base and address all P0/P1 findings.
- [ ] Merge the reviewed branch into `prd` with `--no-ff`, without restarting PRD.
