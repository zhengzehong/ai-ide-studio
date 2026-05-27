# Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project scope, RPC boundaries, Workspace composition, ACP runtime boundaries, and future development rules explicit so new features stop accumulating in oversized files.

**Architecture:** Keep the existing Hono/WS + SQLite + ACP stack, but insert thin domain services and RPC handlers between gateway and stores. Treat `projectId` as mandatory for project-level entities, keep `agent_templates` global, and make `agents` project-scoped instances deployable from templates. Split Workspace into focused components without changing visual style.

**Tech Stack:** TypeScript, Hono, ws, better-sqlite3, mitt, React 19, Zustand, Vitest.

---

## Task 1: Project Scope Domain Rules

**Files:**
- Modify: `src/store/agents.ts`
- Modify: `src/store/sessions.ts`
- Modify: `src/store/tasks.ts`
- Modify: `src/store/rules.ts`
- Create: `src/core/projects.ts`
- Create: `src/core/agents.ts`
- Create: `tests/integration/project-scope.test.ts`

- [ ] Add a failing integration test proving project-scoped entities are isolated by `projectId`.
- [ ] Update store row/input types and SQL inserts/lists to carry `project_id`.
- [ ] Add domain helpers that validate project existence and derive session project from agent/task.
- [ ] Run `npx vitest run tests/integration/project-scope.test.ts` and make it pass.

## Task 2: Template Deployment

**Files:**
- Modify: `src/store/agents.ts`
- Modify: `src/store/agent-templates.ts`
- Modify: `src/core/agents.ts`
- Create: `tests/integration/template-deploy.test.ts`

- [ ] Add a failing test for `deployTemplateToProject(templateId, projectId)` creating a project Agent with `template_id`, `system_prompt`, and `icon`.
- [ ] Enforce builtin template delete protection in domain code.
- [ ] Run the new template deployment test and make it pass.

## Task 3: WS RPC Handler Split

**Files:**
- Create: `src/gateway/rpc/types.ts`
- Create: `src/gateway/rpc/registry.ts`
- Create: `src/gateway/rpc/sessions.ts`
- Create: `src/gateway/rpc/agents.ts`
- Create: `src/gateway/rpc/tasks.ts`
- Create: `src/gateway/rpc/rules.ts`
- Create: `src/gateway/rpc/projects.ts`
- Create: `src/gateway/rpc/templates.ts`
- Create: `src/gateway/rpc/filesystem.ts`
- Create: `src/gateway/rpc/tools.ts`
- Modify: `src/gateway/ws-handler.ts`
- Update: existing WS tests

- [ ] Move each switch group from `ws-handler.ts` into a domain handler file.
- [ ] Keep `ws-handler.ts` responsible only for JSON parsing, subscriptions, dispatch, and errors.
- [ ] Preserve event broadcasting behavior.
- [ ] Run WS integration tests.

## Task 4: Frontend Project Context and Workspace Split

**Files:**
- Modify: `ui/src/stores/agent.store.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/stores/rule.store.ts`
- Modify: `ui/src/stores/project.store.ts`
- Modify: `ui/src/stores/tool.store.ts`
- Create: `ui/src/components/workspace/ChatBubble.tsx`
- Create: `ui/src/components/workspace/ToolCallPanel.tsx`
- Create: `ui/src/components/workspace/PlanBar.tsx`
- Create: `ui/src/components/workspace/ChatInput.tsx`
- Create: `ui/src/components/workspace/WorkspaceSidebar.tsx`
- Create: `ui/src/components/workspace/WorkspaceTaskPanel.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/layout/AppLayout.tsx`

- [ ] Add project-aware fetch methods for project-level stores.
- [ ] Reset session/file state on project changes.
- [ ] Replace standalone `tool.store` WebSocket code with shared `wsClient`.
- [ ] Extract Workspace components while keeping the same rendered structure and style.
- [ ] Fix the current `AppLayout.tsx` unused parameter build failure.
- [ ] Run `npm run build`.

## Task 5: ACP Host Interface and Project Working Directory

**Files:**
- Create: `src/acp/runtime-registry.ts`
- Create: `src/acp/capabilities.ts`
- Create: `src/acp/update-mapper.ts`
- Modify: `src/acp/host.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/tools/resolver.ts`
- Create: `tests/integration/session-project-cwd.test.ts`

- [ ] Add a failing test that session creation uses the project's `work_dir` as ACP cwd and resolves tools with `projectId`.
- [ ] Move runtime command registry and capability helpers out of `host.ts`.
- [ ] Thread `projectId` and `workDir` from session manager into ACP new/resume/fork session calls.
- [ ] Run ACP/session tests.

## Task 6: Development Rules Documentation and Final Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/scope-and-navigation.md`

- [ ] Add rules: no new RPC cases in `ws-handler.ts`; project-level data requires `projectId`; Workspace additions require focused components; ACP runtime changes go through adapter/helper files.
- [ ] Update architecture docs to match the refactored boundaries.
- [ ] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
