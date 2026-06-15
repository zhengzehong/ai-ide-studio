# Workspace Agent Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Workspace session-sidebar controls to delete project Agents and hide/show project Agents.

**Architecture:** Persist hidden state on `agents.hidden_at` and expose it through a narrow `agents.setHidden` RPC. Workspace filters hidden Agents only in the session sidebar, while keeping hidden Agents available through the new show/hide management popover. Existing hard delete behavior stays on `agents.delete`.

**Tech Stack:** TypeScript, SQLite migrations, Hono WS RPC, React, Zustand, Vitest.

---

### Task 1: Backend Hidden State

**Files:**
- Create: `src/store/migrations/018-agent-visibility.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/agents.ts`
- Modify: `src/gateway/rpc/agents.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/integration/workspace-ordering.test.ts`
- Test: `tests/integration/session-management-rpc.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert:
- `agents.hidden_at` exists after migration.
- `agentStore.setHidden(agentId, true)` sets a timestamp.
- `agentStore.setHidden(agentId, false)` clears the timestamp.
- `agents.setHidden` RPC returns the updated Agent row.

- [x] **Step 2: Run RED checks**

Run:
`npm test -- tests/integration/workspace-ordering.test.ts tests/integration/session-management-rpc.test.ts`

Expected before implementation: tests fail because `hidden_at` / `setHidden` / `agents.setHidden` do not exist.

- [x] **Step 3: Implement persistence and RPC**

Add the migration, store field/method, protocol type, and RPC handler.

### Task 2: Frontend Workspace Controls

**Files:**
- Modify: `ui/src/stores/agent.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [x] **Step 1: Add store method**

Add `hidden_at` to `AgentData` and `setAgentHidden(agentId, hidden)` to Zustand.

- [x] **Step 2: Add Workspace filtering and controls**

Use all project Agents for management, visible project Agents for the left tree. Add:
- Agent context-menu item `隐藏 Agent`
- Agent context-menu item `删除 Agent`
- top-row `显示/隐藏 Agent` button and popover
- empty state when all Agents are hidden

- [x] **Step 3: Keep selected hidden/deleted Agent safe**

If the selected session belongs to a hidden/deleted Agent, clear the selected session.

### Task 3: Verify And Ship

**Files:**
- Review all changed files from Tasks 1-2.

- [ ] **Step 1: Run targeted tests**

Run:
`npm test -- tests/integration/workspace-ordering.test.ts tests/integration/session-management-rpc.test.ts`

- [ ] **Step 2: Run required project checks**

Run:
`npm test`
`npm run lint`
`npm run build`
`git diff --check`

- [ ] **Step 3: Commit only this task and update prd**

Commit only files touched for this feature, then cherry-pick to `D:\code_space\python_space\ai-ide-studio-prd` and push `origin/prd`.
