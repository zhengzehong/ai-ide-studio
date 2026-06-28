# Core Model Profile Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI-facing MCP tools list model profiles and bind a model profile while creating an Agent.

**Architecture:** Keep the change inside the existing core MCP tool layer. `core.agent.create` forwards `modelProfileId` into existing Agent core services, and a new read-only `core.model_profile.list` handler calls `modelProfileStore.list`.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing MCP tool registry.

---

### Task 1: Add tests for AI-facing model profile tools

**Files:**
- Modify: `tests/unit/core-tool-handlers.test.ts`
- Modify: `tests/unit/tool-seed.test.ts`

- [x] Add handler tests proving `core.agent.create` persists `modelProfileId` for custom and template Agents.
- [x] Add handler test proving `core.model_profile.list` filters enabled profiles by runtime.
- [x] Add seed test expectations for the new tool and visible `modelProfileId` schema.

### Task 2: Implement minimal MCP tool support

**Files:**
- Modify: `src/tools/seed.ts`
- Modify: `src/tools/handlers/core/agent-tools.ts`
- Create: `src/tools/handlers/core/model-profile-tools.ts`
- Modify: `src/tools/handlers/core/index.ts`
- Modify: `src/tools/handlers/index.ts`

- [x] Add `modelProfileId` to the `core.agent.create` input schema.
- [x] Forward `modelProfileId` to `deployTemplateToProject` and `createCustomProjectAgent`.
- [x] Register `core.model_profile.list` as a global, read-only built-in tool.
- [x] Implement the handler with optional `runtime` and `enabledOnly` inputs.

### Task 3: Verify and document

**Files:**
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `README.md`

- [x] Document `core.model_profile.list` as an AI-facing core MCP tool.
- [x] Run targeted tests first, then `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
- [ ] Commit only files touched for this task, then merge the commit into the PRD worktree branch.
