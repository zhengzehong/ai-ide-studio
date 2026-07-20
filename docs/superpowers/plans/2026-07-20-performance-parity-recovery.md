# Performance Branch Functional Parity Recovery Implementation Plan

> **For Codex:** Execute each checkbox in order with RED, GREEN, and focused verification. Do not merge `prd`.

**Goal:** Restore all confirmed PRD functional behavior on the process-isolated performance branch while keeping one public endpoint and independent performance data.

**Architecture:** Preserve HTTP durable Commands, Runtime and Realtime child processes, Query/Writer workers, and project-partitioned browser caches. Restore behavior at explicit typed boundaries rather than adding compatibility refreshes or synchronous fallbacks.

**Tech Stack:** TypeScript, Node.js child processes and worker threads, Hono, ws, better-sqlite3, React 19, Zustand, Vitest.

## Batch 1: PC Session, Prompt, Images, and Global Assistant

- [x] Add an integration test proving Agent deployment emits a complete `session:changed` for the primary Session.
- [x] Centralize Session creation publication and use it from normal create, copy, and Agent deployment paths; seed/backfill remains in Batch 5.
- [x] Verify the existing browser-store regression routes a complete event only to `data.project_id` and bypasses stale TTL data.
- [x] Add command parser/route tests for image-only Prompt, mixed Prompt, configurable default 16 MiB limit, and 413 errors.
- [x] Add command-client and Session-store tests for awaiting a `202 accepted` receipt and rolling back optimistic message/running state on failure.
- [x] Keep Workspace text/images until acceptance, restore them on failure, and show a Chinese validation error.
- [ ] Add a PC shell regression test proving global assistant/page state remains mounted during temporary disconnect.
- [x] Run all focused PC, HTTP Command, Session creation, and project-cache tests.
- [x] Commit Batch 1 and report a task milestone.

## Batch 2: Runtime Child Failure and Interaction Cleanup

- [x] Add Runtime host tests proving child stderr is drained and contextualized without leaking full Prompt content.
- [x] Add a failed-initialize test proving router close, child termination, and no Agent registration.
- [x] Add child-exit tests proving all Agent Session bindings are removed and a later ensure resumes with a new child.
- [x] Add active-turn crash tests proving child exit rejects the active Prompt so API publishes one error done and cannot publish a false successful done.
- [x] Add interaction tests for cancel, Session close, Agent stop, child exit, and Runtime close; all pending permission/elicitation promises resolve cancelled.
- [x] Make close/stop cleanup idempotent and safe under simultaneous exit and explicit close.
- [x] Run focused Runtime process, crash recovery, command parity, and interaction tests.
- [x] Commit Batch 2 and report a task milestone.

## Batch 3: Runtime Identity, Lifecycle IPC, and ACP Mapping

- [x] Add unit tests for stable Agent environment and Session context fingerprints, including order-insensitive structured values.
- [x] Add concurrent ensure tests proving same-Session deduplication and cross-Session independence through separate Agent start and Session ensure maps.
- [x] Add typed Runtime IPC protocol coverage for Agent status and lifecycle messages.
- [x] Persist/publish Agent running/standby and lifecycle from API once; add duplicate status regression coverage.
- [x] Port ACP update mapping tests for user chunks, complete tool content/diff/terminal/progress payloads, terminal output, and current-mode capability updates.
- [x] Implement missing mappings using small dedicated helpers and keep affected backend files under 400 lines.
- [x] Run Runtime snapshot, protocol, command parity, ACP mapping, and Realtime stream tests.
- [x] Commit Batch 3 and report a task milestone.

## Batch 4: Realtime and Mobile Recovery

- [ ] Add ws-client tests proving listeners are ready before subscribe/resume and reconnect cannot race listener installation.
- [ ] Add PC resync tests that resolve the Session owner project and refresh that project's Session/messages/events/cache even when inactive.
- [ ] Register application listeners for the lifetime of the application shell rather than per connection.
- [ ] Add mobile shell tests proving a transient disconnect preserves current page, selected Session, messages, and draft.
- [ ] Keep reconnect controls visible without replacing the active application tree; explicit logout remains unchanged.
- [ ] Run PC ws-client/bootstrap/project-scope and mobile connection/session tests.
- [ ] Commit Batch 4 and report a task milestone.

## Batch 5: Idle Sweep, Recovery Pagination, and Primary Session Reconciliation

- [ ] Add Runtime idle-sweep tests for idle Sessions, idle Agents, active turns, and pending interactions.
- [ ] Add configuration and lifecycle wiring for a process Runtime sweep timer with clean shutdown.
- [ ] Extend the Writer ledger port with deterministic cursor pagination and test recovery beyond 1,000 Commands.
- [ ] Update RuntimeCommandDispatcher startup to exhaust pages without duplicates or starvation.
- [ ] Add fresh/existing database tests proving every non-template Agent has exactly one primary Session and reconciled Sessions publish correctly where required.
- [ ] Fix or deterministically await the full-suite `rules-session-reuse` background Prompt lifecycle if the unhandled rejection reproduces.
- [ ] Run focused maintenance, recovery, seed, Runtime lifecycle, and full database tests.
- [ ] Commit Batch 5 and report a task milestone.

## Final Verification and Review

- [ ] Run `npm test` with `LOG_DIR` under `data-perf`; require zero unhandled errors.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run perf:phase5:smoke`.
- [ ] Start `scripts/start-performance-local.ps1` on port `19000` with `data-perf` and smoke-test same-origin HTTP, WebSocket, Agent deployment/primary Session, text Prompt, image-only Prompt, cancel, and reconnect.
- [ ] Confirm port `18900`, `data-prd`, and branch `prd` are unchanged.
- [ ] Update architecture/protocol/data-model/README documentation only where stable contracts changed.
- [ ] Commit the complete branch and request one review from `code-reviewer` session `sess-7a6061e9`.
- [ ] Address review findings and rerun affected plus final verification.
- [ ] Leave the branch unmerged pending explicit user approval.
