# Claude ACP 0.60 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the stable Claude ACP pair that fixes terminal-result hangs without changing application APIs.

**Architecture:** Change only the direct ACP package version and let npm resolve the package's exact Claude Agent SDK dependency. Verify the existing ACP protocol adapter remains compatible.

**Tech Stack:** Node.js, npm, ACP JSON-RPC, TypeScript, Vitest.

---

### Task 1: Update Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Set `@agentclientprotocol/claude-agent-acp` to exact version `0.60.0`.
- [x] Run `npm install` and confirm the resolved Claude Agent SDK is `0.3.215`.

### Task 2: Verify Compatibility

- [x] Run `npx tsc --noEmit`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run `git diff --check` and inspect the dependency diff.
