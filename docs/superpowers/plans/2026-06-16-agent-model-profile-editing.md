# Agent Model Profile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let project Agents and the global assistant bind or change model profiles after creation, while creation flows default to the configured runtime profile.

**Architecture:** Keep model profile binding on Agent instances through `config_json.modelProfileId`. Reuse existing model profile validation for project Agents, add the same validation path for the global assistant, and expose the field in the existing Agent UI surfaces.

**Tech Stack:** Hono/WebSocket RPC, SQLite stores, React 19, Zustand, Vitest.

---

### Task 1: Backend Global Assistant Model Profile Binding

**Files:**
- Modify: `src/gateway/rpc/global-assistant.ts`
- Test: `tests/unit/global-assistant-store.test.ts` and/or a backend unit test covering RPC/core behavior

- [ ] Add failing coverage that `globalAssistant.setTemplate` accepts `modelProfileId` and stores it in the created global Agent config.
- [ ] Add failing coverage that an existing global assistant can update/clear `modelProfileId`.
- [ ] Implement validation: profile must exist, be enabled, and match the Agent runtime.
- [ ] Keep existing behavior unchanged when no profile is supplied.

### Task 2: Frontend Shared Model Profile Selector

**Files:**
- Modify: `ui/src/components/agent-square/DeployTemplateModal.tsx`
- Create/Modify a small reusable selector only if duplication becomes meaningful.

- [ ] Default the selector to the first enabled profile for the selected runtime.
- [ ] Keep "不绑定模型档案" available.
- [ ] Reset selection when runtime changes to a runtime without the current profile.

### Task 3: Agent Detail Editing

**Files:**
- Modify: `ui/src/pages/Workspace.tsx` or the existing Agent details component if present.
- Modify: `ui/src/stores/agent.store.ts` only if the input type needs widening.

- [ ] Add model profile field to the Agent edit/details surface.
- [ ] Use `agents.update` with `modelProfileId`, including empty string/null to clear.
- [ ] Refresh local Agent state after save.

### Task 4: Global Assistant Configuration UI

**Files:**
- Modify: `ui/src/pages/AgentSquare.tsx`
- Modify: `ui/src/stores/global-assistant.store.ts`

- [ ] Replace direct "设为全局助理" action with a small configuration modal.
- [ ] Include model profile selector for `claude`/`codex` runtimes.
- [ ] Send `modelProfileId` through `globalAssistant.setTemplate`.
- [ ] Allow existing global assistant model profile update through the same backend capability.

### Task 5: Verification and Integration

**Files:**
- No production file changes expected.

- [ ] Run focused unit tests for global assistant/model profile behavior.
- [ ] Run TypeScript build/lint checks that cover touched UI.
- [ ] Review `git diff --check` and the final diff.
- [ ] Commit one focused change.
- [ ] Cherry-pick the commit to local `prd` branch without pushing.
