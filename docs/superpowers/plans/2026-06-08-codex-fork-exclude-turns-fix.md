# Codex Fork Exclude Turns Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Codex session copy/fork by avoiding the experimental `excludeTurns` field in the codex-acp fork request.

**Architecture:** Keep the fix inside the existing `patch-package` patch for `@agentclientprotocol/codex-acp`. AI IDE already copies only the latest local messages, so Codex fork does not need the experimental lightweight turn response path.

**Tech Stack:** TypeScript, Vitest, patch-package, Codex app-server protocol.

---

### Task 1: Patch Regression Guard

**Files:**
- Create: `tests/unit/codex-acp-patch.test.ts`
- Modify: `patches/@agentclientprotocol+codex-acp+0.0.44.patch`

- [ ] **Step 1: Write failing test**

Add a test that reads `patches/@agentclientprotocol+codex-acp+0.0.44.patch` and asserts it still adds fork support while not adding `excludeTurns: true`.

- [ ] **Step 2: Verify test fails**

Run: `npm test -- tests/unit/codex-acp-patch.test.ts`
Expected: FAIL because the current patch adds `excludeTurns: true`.

- [ ] **Step 3: Remove experimental fork field**

Remove `excludeTurns: true` from the codex-acp fork request in both `node_modules/@agentclientprotocol/codex-acp/dist/index.js` and the patch file.

- [ ] **Step 4: Verify focused tests**

Run: `npm test -- tests/unit/codex-acp-patch.test.ts tests/unit/acp-fork-session.test.ts tests/integration/ws-copy-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

Run: `npm run build`
Expected: PASS.

Commit only the plan, test, patch, and generated lock/package patch changes if any.
