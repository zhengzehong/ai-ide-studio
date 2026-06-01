# Team Leader No-Wait Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure real Team Leaders do not sleep, wait, or poll after dispatching work; member progress should wake the Leader asynchronously.

**Architecture:** Keep prompt wording in `src/core/team-prompts.ts`. Wrap only Team Leader session prompts at the session boundary so all ACP runtimes receive the same collaboration contract before the user content. Detect Team Leader sessions from `team_members.role = leader` or from the Team Leader tool profile binding.

**Tech Stack:** TypeScript, Vitest, SQLite stores, existing session manager and Team prompt helpers.

---

## File map

- Modify `src/core/team-prompts.ts`: add a Team Leader prompt wrapper and idempotence guard.
- Modify `src/core/sessions.ts`: wrap ACP prompt content for Team Leader sessions before sending to ACP while preserving the original human message in UI/history.
- Modify `tests/unit/team-tool-handlers.test.ts`: add focused unit coverage for the Leader prompt contract.

---

### Task 1: Add failing tests for the Team Leader prompt wrapper

**Files:**
- Modify: `tests/unit/team-tool-handlers.test.ts`

- [ ] Add tests that verify `sessionManager.sendPrompt()` sends a no-wait contract to ACP for Team Leader sessions but stores the original human content unchanged.
- [ ] Run the focused test and confirm it fails before implementation.

### Task 2: Implement the Team Leader prompt wrapper

**Files:**
- Modify: `src/core/team-prompts.ts`
- Modify: `src/core/sessions.ts`

- [ ] Add `buildTeamLeaderPrompt()` / `isTeamLeaderPrompt()` helper text with these rules: after `team.member.message`, do not wait/sleep/poll; end the turn; the system wakes you on member progress.
- [ ] In `sessionManager.sendPrompt()`, detect leader sessions via `teamMemberStore.getBySession(sessionId)?.role === 'leader'` and send wrapped content to `acpHost.prompt()`.
- [ ] Keep `messageStore.append()` and `eventStore.append(message.user)` using the original user content.
- [ ] Run focused tests and confirm they pass.

### Task 3: Verify real behavior

**Files:**
- Temporary harness only: `.tmp/team-real-smoke.mjs`

- [ ] Run `npm test -- tests/unit/team-tool-handlers.test.ts`.
- [ ] Run the real simple smoke with Claude Leader + Codex member.
- [ ] Inspect `result.json` for actual `kind:"execute"` sleep commands and waiting/polling tool patterns.
- [ ] If simple passes without sleeps, run the complex smoke and inspect the same evidence.

### Task 4: Full verification and report

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Report exact run paths, counts, and any remaining risk.
