# Real Team ACP Smoke Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify real Claude/Codex ACP Team workflows without mock members, covering one simple task and one multi-round task, then identify tool/prompt issues.

**Architecture:** Use a temporary SQLite data directory and temporary project directory. Start the real gateway so HTTP MCP tools are available, create real-runtime Agent templates, let a Claude leader drive `team.*` tools, auto-approve ACP permission requests in the harness, and inspect persisted Team/session/tool events after execution. No UI work is included.

**Tech Stack:** TypeScript runtime via `tsx`, `@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp` when available, SQLite stores, existing Team MCP tools.

---

### Task 1: Prepare a real-runtime smoke harness

**Files:**
- Create temporary only: `.tmp/team-real-smoke.mjs`

- [ ] Start `startApp()` on a temporary port with a temporary `DATA_DIR` and `PUBLIC_BASE_URL`.
- [ ] Create a temporary Project and real-runtime Agent templates.
- [ ] Create a Claude Leader Agent and apply the `team-leader` profile.
- [ ] Add a permission auto-approval loop that scans every active session event for `permission.request` and responds `allow_always`.
- [ ] Capture final Teams, members, tasks, mailbox, leader/member messages, and tool call events.

### Task 2: Run simple real-member workflow

**Files:**
- Temporary harness only.

- [ ] Prompt Claude Leader to create one Team, spawn one non-mock member, create one small task, dispatch it, and require the member to send mailbox feedback and mark the task completed.
- [ ] Wait for leader and member sessions to finish or for mailbox/task completion to appear.
- [ ] Verify: at least one non-leader member exists, member Agent runtime is not `mock`, mailbox is from the member, and task status is `completed`.

### Task 3: Run multi-round real-member workflow

**Files:**
- Temporary harness only unless a real product issue is found.

- [ ] Prompt Claude Leader to create a Team with two non-mock members, assign a planner/dev subtask and a reviewer subtask, require mailbox handoff between members, and require final task completion.
- [ ] Wait for all spawned member sessions and final task/mailbox closure.
- [ ] Verify: multiple member sessions ran, mailbox contains member-authored feedback, at least one task completed, and leader final summary matches stored DB state.

### Task 4: Review findings and make minimal backend adjustments if needed

**Files:**
- Modify only if a verified backend/tool issue appears.

- [ ] Inspect tool calls for wrong actor behavior, missing context, invalid status values, permission stalls, or leader faking member feedback.
- [ ] If a product bug is found, add a failing unit test first, implement the minimal fix, then rerun targeted tests.
- [ ] If the issue is prompt/tool affordance rather than code, record concrete suggested prompt/tool changes instead of changing UI.

### Task 5: Final verification

**Files:**
- No production files unless Task 4 changes code.

- [ ] Run targeted Team tests if code changed.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Report exact real smoke evidence and remaining risks.
