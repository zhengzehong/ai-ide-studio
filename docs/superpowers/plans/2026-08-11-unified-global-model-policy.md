# Unified Global Model Profile Implementation Plan

**Goal:** Let Claude Code and Codex Agents follow one Runtime-specific global model profile while preserving explicit fixed profiles and the existing system configuration fallback.

**Architecture:** Store one optional profile ID per Runtime in the existing `settings` table. Resolve the effective profile while building each Runtime Snapshot using the priority selected by `agents.config_json.modelProfileMode`: global, fixed, or system. Reuse the existing Runtime fingerprint and idle replacement behavior so changes are isolated to the affected Agent and require no service restart.

**Tech Stack:** TypeScript 6, Hono RPC handlers, better-sqlite3, React 19, Zustand, Vitest 4.

---

### Task 1: Add the global profile policy

- [x] Add typed global profile persistence for Claude Code and Codex.
- [x] Preserve legacy explicit Agent profile bindings as fixed bindings.
- [x] Resolve global, fixed, and system modes while building Runtime environments.
- [x] Add bulk Agent mode updates without changing stored fixed profile IDs.

### Task 2: Expose the policy through RPC and settings UI

- [x] Add get, set, and clear RPCs for Runtime global profiles.
- [x] Add the global profile selectors and bulk follow/system actions to Settings.
- [x] Add an Agent-level profile policy selector while retaining the fixed profile selector.
- [x] Keep deleted, disabled, or Runtime-moved profiles from leaving stale global bindings.

### Task 3: Verify behavior and compatibility

- [x] Cover Claude and Codex global profile resolution, legacy fixed bindings, and system bypass.
- [x] Cover RPC validation for Runtime mismatch and disabled Providers.
- [x] Update architecture, protocol, data model, and user-facing feature documentation.
- [x] Run focused tests, full tests, lint, build, typecheck, and `git diff --check`.
- [x] Review the final diff for scope, credential safety, and Runtime lifecycle regressions.

### Task 4: Integrate without disturbing PRD

- [ ] Commit the reviewed feature branch.
- [ ] Merge it into `prd` with `--no-ff`.
- [ ] Do not restart, stop, or rebuild the currently running PRD service.
