# Codex Model Provider Env Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ensure Codex ACP runtime resumes sessions with the user's configured Codex model provider instead of falling back to OpenAI.

**Architecture:** Keep the fix inside the runtime registry boundary. uildRuntimeEnv('codex') will preserve explicit environment overrides, otherwise read model_provider from Codex config and set MODEL_PROVIDER for codex-acp; non-Codex runtimes are unchanged.

**Tech Stack:** TypeScript, Vitest, Node fs/path/os helpers.

---

### Task 1: Runtime Environment Provider Detection

**Files:**
- Modify: src/acp/runtime-registry.ts
- Test: 	ests/unit/runtime-registry.test.ts

- [ ] **Step 1: Add failing tests**

Add tests that verify:
- codex runtime reads model_provider = "club" from a supplied config file path and sets MODEL_PROVIDER=club.
- explicit MODEL_PROVIDER=openai is preserved.
- missing config or OpenAI config does not break default behavior.
- claude runtime does not get Codex-specific env.

- [ ] **Step 2: Run targeted tests and verify RED**

Run:
pm test -- tests/unit/runtime-registry.test.ts

Expected: new MODEL_PROVIDER config test fails before implementation.

- [ ] **Step 3: Implement minimal runtime env change**

In untime-registry.ts:
- Add an optional config path resolver parameter to uildRuntimeEnv with default esolveCodexConfigPath.
- If untime === 'codex' and env.MODEL_PROVIDER is empty, parse model_provider = "..." from the config file.
- Set env.MODEL_PROVIDER only when the parsed value is non-empty.
- Preserve CODEX_PATH behavior.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run:
pm test -- tests/unit/runtime-registry.test.ts

Expected: all runtime registry tests pass.

### Task 2: Compatibility Verification

**Files:**
- No production files beyond Task 1.

- [ ] **Step 1: Run build and relevant tests**

Run:
-
pm test -- tests/unit/runtime-registry.test.ts
-
pm run build

Expected: both pass.

- [ ] **Step 2: Optional live validation**

If the service is running, restart and test Codex resume manually. Otherwise use the direct app-server reproduction already established: resume with explicit provider from config should not fall back to OpenAI.
