# Session Runtime Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-session model, mode, and config selections so service restarts and ACP reconnects keep the user's choices, with Codex defaulting to full access and Claude Code defaulting to bypass permissions when available.

**Architecture:** Store session runtime preferences in `sessions.runtime_preferences_json` as the backend source of truth. RPC handlers persist successful user changes, and ACP host applies saved preferences or runtime defaults immediately after `newSession`, `resumeSession`, `loadSession`, and fork initialization report available capabilities.

**Tech Stack:** TypeScript, Hono gateway RPC, better-sqlite3 migrations, ACP ClientSideConnection, Vitest.

---

### Task 1: Persist Runtime Preferences

**Files:**
- Create: `src/store/migrations/012-session-runtime-preferences.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/sessions.ts`
- Test: `tests/unit/session-runtime-preferences.test.ts`

- [ ] Add a migration that safely adds `sessions.runtime_preferences_json TEXT`.
- [ ] Add `SessionRuntimePreferences` with `modelId?: string`, `modeId?: string`, and `config?: Record<string, string | boolean>`.
- [ ] Add store helpers to read and merge preferences without overwriting unrelated keys.
- [ ] Test that preferences survive database reload and merge model/mode/config independently.

### Task 2: Apply Preferences After ACP Session Creation

**Files:**
- Modify: `src/acp/host.ts`
- Create: `src/acp/session-runtime-preferences.ts`
- Test: `tests/unit/acp-session-runtime-preferences.test.ts`

- [ ] Add a resolver that returns saved preferences first.
- [ ] If no saved mode exists, default `codex` to `agent-full-access` and `claude` to `bypassPermissions`.
- [ ] Apply desired model, mode, and config only when present in current capabilities.
- [ ] Do not fail session creation when a desired value is unavailable; log a warning and keep ACP's actual current value.
- [ ] Test Codex default full access, Claude default bypass, unavailable bypass fallback, and saved preference precedence.

### Task 3: Persist User Changes From RPC

**Files:**
- Modify: `src/gateway/rpc/sessions.ts`
- Test: `tests/unit/session-runtime-preferences-rpc.test.ts` or focused store/host tests if RPC wiring is covered indirectly.

- [ ] After successful `session.setModel`, persist `modelId`.
- [ ] After successful `session.setMode`, persist `modeId`.
- [ ] After successful `session.setConfig`, persist `config[configId]`.
- [ ] Keep RPC responses unchanged.

### Task 4: Verify And Review

**Files:**
- Review all changed files.

- [ ] Run focused tests for runtime preferences.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Review diff for unrelated changes, credential leaks, and behavior regressions.
- [ ] Commit to current branch.
- [ ] Cherry-pick the commit to `prd` and verify status.
