# Project Agent Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the long-term Agent workflow where global Agent templates are added to projects as project-scoped Agent instances, and only those project Agents can create Workspace conversations.

**Architecture:** Keep `agent_templates` global and treat `agents` as project-scoped runtime instances. Add backend RPCs for deploying templates and managing project Agents, then connect Agent Square and Workspace empty states to that flow. Preserve current UI style while renaming user-facing concepts from generic Agent creation to template management and project Agent addition.

**Tech Stack:** Hono + ws + better-sqlite3 + Pino backend, React 19 + TypeScript + Zustand frontend, Vitest tests.

---

## File Map

- Modify `src/core/agents.ts`: add project Agent domain functions for deploy, custom create, update, delete, and validation.
- Modify `src/store/agents.ts`: support updating Agent fields and soft delete if available; keep list project-scoped.
- Modify `src/gateway/ws-handler.ts`: expose `agents.deployTemplate`, `agents.createCustom`, `agents.update`, `agents.delete` while keeping old `agents.create` compatible.
- Modify `src/types/ws-protocol.ts`: add WS message interfaces for new Agent RPCs.
- Modify `ui/src/stores/agent.store.ts`: add frontend actions for deploy/create/update/delete with projectId.
- Modify `ui/src/pages/AgentSquare.tsx`: rename creation to template creation and add “添加到项目” flow.
- Modify `ui/src/pages/Workspace.tsx`: add empty state CTA for adding project Agents.
- Modify `ui/src/pages/Dashboard.tsx`: stop creating global Agents; route to project Agent addition or create project-scoped Agent.
- Add/modify tests under `tests/integration/`: verify deploy/custom Agent RPCs are project scoped and enforce projectId.
- Update docs: `docs/architecture/scope-and-navigation.md`, `docs/architecture/ws-protocol.md`, `docs/architecture/data-model.md`, `docs/architecture/overview.md`, `README.md`.

## Tasks

### Task 1: Backend tests for project Agent RPCs

**Files:**
- Modify: `tests/integration/template-deploy.test.ts`
- Modify: `tests/integration/session-management-rpc.test.ts`

- [ ] Add tests proving `agents.deployTemplate` creates an Agent with `project_id`, `template_id`, copied prompt/icon, and appears only in `agents.list(projectId)`.
- [ ] Add tests proving `agents.createCustom` requires `projectId` and creates a project-scoped custom Agent.
- [ ] Add tests proving `agents.update` can update name/system prompt/runtime for the project Agent.
- [ ] Add tests proving `agents.delete` removes the Agent from project listing.
- [ ] Run: `npm test -- tests/integration/template-deploy.test.ts tests/integration/session-management-rpc.test.ts`
- [ ] Expected: new tests fail because the RPCs do not exist yet.

### Task 2: Backend implementation

**Files:**
- Modify: `src/core/agents.ts`
- Modify: `src/store/agents.ts`
- Modify: `src/gateway/ws-handler.ts`
- Modify: `src/types/ws-protocol.ts`

- [ ] Add `createCustomProjectAgent(input)` in `src/core/agents.ts`; require an existing `projectId`, supported runtime, non-empty name, and create `agents.project_id`.
- [ ] Extend `deployTemplateToProject()` to accept runtime/systemPrompt/icon/type overrides only where needed; default remains a template snapshot.
- [ ] Add `updateProjectAgent(agentId, fields)` and `deleteProjectAgent(agentId)` domain functions.
- [ ] Add store update support in `src/store/agents.ts` for name/type/runtime/system_prompt/icon/config_json/status.
- [ ] Add WS cases for `agents.deployTemplate`, `agents.createCustom`, `agents.update`, `agents.delete`.
- [ ] Keep legacy `agents.create` for compatibility, but frontend should stop using it.
- [ ] Run targeted tests until passing.

### Task 3: Frontend store and Agent Square flow

**Files:**
- Modify: `ui/src/stores/agent.store.ts`
- Modify: `ui/src/pages/AgentSquare.tsx`

- [ ] Add store actions: `deployTemplate(projectId, templateId, input?)`, `createCustomAgent(projectId, input)`, `updateAgent`, `deleteAgent`.
- [ ] Rename Agent Square heading/actions from generic “创建 Agent” to “创建模板”.
- [ ] Add card action “添加到项目”.
- [ ] Add modal to choose current project, Agent name, runtime, and optional prompt override.
- [ ] On success, refresh project Agents and provide a clear success state; if project selected, allow navigating to Workspace.

### Task 4: Workspace and Dashboard UX

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/pages/Dashboard.tsx`

- [ ] In Workspace, when `agents.length === 0`, show empty state with “添加智能体” CTA linking to Agent Square.
- [ ] Keep existing conversation behavior: expand Agent, create Session, send prompt.
- [ ] Update Dashboard “新建 Agent” to “添加智能体”, and route users to Agent Square or use project-scoped custom create if a project is selected.
- [ ] Ensure all visible user-facing text is Chinese.

### Task 5: Documentation

**Files:**
- Modify: `docs/architecture/scope-and-navigation.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/overview.md`
- Modify: `README.md`

- [ ] Document global template vs project Agent instance.
- [ ] Document project Agent RPCs.
- [ ] Document data model fields and legacy global Agent compatibility.
- [ ] Document user workflow: select project → add Agent to project → create Session → chat.

### Task 6: Verification

**Files:**
- No code changes unless verification exposes defects.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Fix any failures caused by this change.
