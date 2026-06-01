# Team Member Auto Permission and Closed Loop Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spawned Team members automatically get member-level Team tools, and the backend Team workflow is verified from leader creation through member feedback and task completion.

**Architecture:** Keep the change inside the Team service boundary. `team.member.spawn` continues to create the Agent, Session, and TeamMember, then applies the existing `team-member` tool profile to the spawned Agent so its future ACP/MCP session can see mailbox and task update tools. Tests exercise the real handlers and tool visibility resolver without adding UI work.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing Team MCP handlers, existing `team-profiles` helper.

---

### Task 1: Add failing tests for spawned member permissions and closed loop

**Files:**
- Modify: `tests/unit/team-tool-handlers.test.ts`
- Modify: `tests/unit/tool-profiles.test.ts` if a lower-level profile assertion is needed

- [ ] Add a test proving `team.member.spawn` grants `team-member` visibility to the spawned Agent.
- [ ] Add a test proving a leader can create Team, spawn member, create assigned task, dispatch work, and the member can send mailbox feedback and mark the task completed using member context.
- [ ] Run targeted tests and verify the new permission test fails before production code changes.

### Task 2: Apply member profile inside Team spawn

**Files:**
- Modify: `src/core/teams.ts`

- [ ] Import `applyToolProfileToAgent`.
- [ ] After `teamMemberStore.create(...)`, call `applyToolProfileToAgent({ profileId: 'team-member', agentId: agent.id })`.
- [ ] Keep this surgical: no UI, no new profile type, no role policy matrix.
- [ ] Run targeted tests and verify green.

### Task 3: Verify full backend and ACP-adjacent behavior

**Files:**
- No production files unless tests expose a real issue.

- [ ] Run `npm test -- tests/unit/team-tool-handlers.test.ts tests/unit/tool-profiles.test.ts tests/unit/tool-gateway-resolver.test.ts`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.

### Task 4: Runtime smoke boundary for Claude Leader

**Files:**
- No committed production changes required.

- [ ] Confirm local `claude` and `claude-agent-acp` commands exist.
- [ ] If credentials/runtime allow, create a temporary project and a Claude runtime leader in a temporary DB, apply `team-leader`, and send a prompt requesting Team creation/spawn/task/feedback.
- [ ] Report exact result. If real Claude cannot be fully automated due credentials/model/tool behavior, report the verified backend closure separately from the runtime blocker.
