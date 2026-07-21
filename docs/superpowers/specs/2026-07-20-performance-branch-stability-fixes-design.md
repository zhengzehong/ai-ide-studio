# Performance Branch Stability Fixes Design

## Scope

This change fixes three confirmed regressions on `feat/single-port-edge-gateway` without migrating all stores to the Writer Worker and without touching `prd`:

1. Writer batches fail with `database is locked` during concurrent API writes.
2. HTTP permission and cancellation commands wait behind the prompt they must unblock.
3. Process Runtime sessions no longer apply the pre-optimization default full-access modes for Codex and Claude.

The branch must run as an isolated test instance on port `19000` with worktree-local `data-perf` storage.

## SQLite Transaction Ownership

The API connection remains a compatibility writer in this fix. Writer batches acquire SQLite's write reservation before reading idempotency and ordering rows by invoking the better-sqlite3 transaction with `IMMEDIATE` behavior. This prevents the deferred read snapshot from becoming stale before the first mutation.

Both read-write connections use a 5-second busy timeout. Busy/locked native SQLite codes are retained in Worker errors so a future lock can be distinguished from schema or constraint failures. The fix does not add unbounded retries and does not claim that Writer is already the only database writer.

## Command Scheduling

Runtime commands use independent per-session lanes:

- `prompt`: turn lane, preserving one active prompt per session.
- `permission.respond` and `elicitation.respond`: interaction lane.
- `session.cancel`: cancellation lane.
- `sessions.markRead`: read-state lane.

Commands in the same lane remain ordered. Commands in control lanes do not wait for a long-running prompt, so an interaction response or cancel request can reach Runtime while the prompt is blocked. Every lane still uses the durable command ledger, idempotency handling, terminal status updates, and dispatcher drain semantics.

Runtime pending interactions are registered before their request is published. This closes the smaller race where an exceptionally fast client response could arrive before the pending request map was populated.

## Runtime Default Modes

Mode selection is shared by embedded and process Runtime paths:

1. A saved session mode wins.
2. Otherwise Codex selects `agent-full-access`.
3. Otherwise Claude selects `bypassPermissions`.
4. Other runtimes keep their advertised current mode.

The process Runtime checks that the desired mode is advertised before calling ACP. An unavailable mode is logged and leaves the current mode unchanged. This design restores baseline behavior without redefining `permission_level` or automatically approving every tool request.

## Verification

- A real WAL database test holds an API write transaction while a Writer batch begins; the Writer must wait and then commit.
- Dispatcher tests keep a prompt unresolved while permission and cancellation commands complete, and verify prompt-to-prompt ordering remains intact.
- Runtime preference tests cover Codex defaults, Claude defaults, saved-mode precedence, unavailable defaults, and the register-before-publish interaction order.
- Full tests, build, lint, and `git diff --check` must pass.
- The isolated launcher must reject port `18900`, use `data-perf`, and expose the single public endpoint on `19000`.

## Non-Goals

- Migrating all synchronous stores to Writer.
- Changing mobile command transport.
- Changing Agent autonomy level semantics.
- Merging or modifying `prd`.
