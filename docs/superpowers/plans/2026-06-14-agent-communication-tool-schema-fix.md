# Agent Communication Tool Schema Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Agent communication MCP tool schemas so required target parameters are visible, and clarify that `agent.message.send` is asynchronous.

**Architecture:** Keep context-owned fields hidden only when they are truly runtime-injected. Preserve explicit business parameters such as target `sessionId` for watch/message-reading tools and `projectId` for `core.project.get`. Update tool metadata and generated prompts so agents send replies and then stop instead of polling or waiting.

**Tech Stack:** TypeScript, Vitest, SQLite-backed tool registry, MCP tool runtime.

---

### Task 1: Runtime Schema Sanitizer Tests

**Files:**
- Modify: `tests/unit/tool-gateway-resolver.test.ts`

- [ ] Add regression tests proving target `sessionId` remains visible for tools that require a session argument.
- [ ] Add regression tests proving `core.project.get` still exposes required `projectId`.
- [ ] Keep the existing coverage that hides runtime-owned team fields and current-project `projectId` for scoped tools.
- [ ] Run the targeted tests and verify the new assertions fail on the current implementation.

### Task 2: Runtime Schema Sanitizer Fix

**Files:**
- Modify: `src/tools/runtime/schema-sanitizer.ts`

- [ ] Remove `sessionId` from the always-hidden field list.
- [ ] Add a small allowlist so `projectId` remains visible for `core.project.get`.
- [ ] Keep hiding `projectId` for normal current-project scoped tools.
- [ ] Run targeted runtime schema tests and verify they pass.

### Task 3: Agent Send Tool Guidance

**Files:**
- Modify: `src/tools/agent-session-seed.ts`
- Modify: `src/tools/handlers/agent-session-tools.ts`
- Modify: `src/core/agent-session-prompts.ts`
- Modify: `tests/unit/agent-session-communication.test.ts`
- Modify: `tests/unit/agent-session-tools.test.ts`

- [ ] Add tests for async wording in seeded and handler descriptions.
- [ ] Add tests for need-reply prompts telling the target agent to reply with `agent.message.send` and not wait afterward.
- [ ] Update seed and handler descriptions for `agent.message.send`.
- [ ] Update need-reply and reminder prompts with the same no-wait instruction.
- [ ] Run targeted communication tests and verify they pass.

### Task 4: Review, Verify, Commit, Sync PRD

**Files:**
- No additional code files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Inspect staged diff and ensure only requested files are staged.
- [ ] Commit on the current branch.
- [ ] Cherry-pick the commit into `D:\code_space\python_space\ai-ide-studio-prd`.
- [ ] Run targeted tests in PRD and report both commit hashes.
