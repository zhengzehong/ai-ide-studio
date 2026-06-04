# Agent System Prompt ACP Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure each AI IDE agent's `system_prompt` reaches Claude Code and Codex without replacing their built-in coding-agent behavior.

**Architecture:** AI IDE builds runtime-specific ACP `_meta` per agent session. Claude receives a `claude_code` preset prompt with `append`, while Codex receives a string that a small `patch-package` patch maps to Codex app-server `developerInstructions`.

**Tech Stack:** TypeScript, ACP SDK `_meta`, `claude-agent-acp`, `codex-acp`, npm `patch-package`, Vitest.

---

### Task 1: AI IDE Session Meta

**Files:**
- Modify: `src/acp/model-profile-env.ts`
- Modify: `src/acp/host.ts`
- Modify: `src/acp/host-types.ts`
- Test: `tests/unit/model-profile-env.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:
- Claude agents with `system_prompt` get `_meta.systemPrompt = { type: 'preset', preset: 'claude_code', append }`.
- Claude model-profile env remains inside `_meta.claudeCode.options.settings.env`.
- Codex agents with `system_prompt` get `_meta.systemPrompt` as a plain string.

- [ ] **Step 2: Verify tests fail**

Run: `npm run test:unit -- tests/unit/model-profile-env.test.ts`
Expected: FAIL because `buildAgentSessionMeta` does not exist yet.

- [ ] **Step 3: Implement minimal session meta builder**

Create `buildAgentSessionMeta(runtime, env, agent)` in `src/acp/model-profile-env.ts`. Keep `buildClaudeSessionMeta` for compatibility and have the new function reuse it.

- [ ] **Step 4: Refresh reused connection session meta**

In `src/acp/host.ts`, build session meta with the new helper and update `existing.sessionMeta` before reusing an existing runtime connection.

- [ ] **Step 5: Verify targeted tests pass**

Run: `npm run test:unit -- tests/unit/model-profile-env.test.ts`
Expected: PASS.

### Task 2: Codex ACP Patch

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `patches/@agentclientprotocol+codex-acp+0.0.44.patch`

- [ ] **Step 1: Add patch-package dependency and postinstall**

Use npm so `package-lock.json` stays consistent:

```bash
npm install --save-dev patch-package
```

Add `postinstall: "patch-package"` to root `package.json`.

- [ ] **Step 2: Patch codex-acp dist output**

Patch `node_modules/@agentclientprotocol/codex-acp/dist/index.js` so `resumeSession`, `loadSession`, and `newSession` pass:

```ts
developerInstructions: getSystemPrompt(request._meta)
```

where `getSystemPrompt` returns a trimmed string or `null`.

- [ ] **Step 3: Generate patch file**

Run:

```bash
npx patch-package @agentclientprotocol/codex-acp
```

Expected: `patches/@agentclientprotocol+codex-acp+0.0.44.patch` is created.

- [ ] **Step 4: Verify patch reapplies**

Run:

```bash
npx patch-package
```

Expected: patch applies cleanly.

### Task 3: Review And Commit

**Files:**
- Review all changed files from Tasks 1-2 only.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run test:unit -- tests/unit/model-profile-env.test.ts
npm run build
```

Expected: both pass.

- [ ] **Step 2: Inspect diff**

Run:

```bash
git diff -- src/acp/model-profile-env.ts src/acp/host.ts src/acp/host-types.ts tests/unit/model-profile-env.test.ts package.json package-lock.json patches/@agentclientprotocol+codex-acp+0.0.44.patch docs/superpowers/plans/2026-06-04-agent-system-prompt-acp-injection.md
git status --short
```

Expected: only task-related changes are staged for commit; unrelated dirty files remain unstaged.

- [ ] **Step 3: Commit**

Use precise staging:

```bash
git add src/acp/model-profile-env.ts src/acp/host.ts src/acp/host-types.ts tests/unit/model-profile-env.test.ts package.json package-lock.json patches/@agentclientprotocol+codex-acp+0.0.44.patch docs/superpowers/plans/2026-06-04-agent-system-prompt-acp-injection.md
git commit -m "fix: inject agent system prompt into ACP runtimes"
```
