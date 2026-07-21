# Performance Branch Functional Parity Recovery Design

## Objective

Restore the user-visible behavior of `prd@eb9ce69` on the performance architecture branch without weakening its process boundaries. The public service remains a single same-origin endpoint, while API, Realtime, Runtime, Query, and Writer retain their current ownership.

This work is isolated to `feat/single-port-edge-gateway`. It must not be merged into `prd` until the user completes independent validation on port `19000` with `data-perf`.

## Compatibility Contract

### Session discovery

Every successful Session creation publishes one complete `session:changed` record containing its persisted `project_id`. Consumers invalidate or merge only that project's Session cache. Agent deployment therefore exposes the automatically created primary Session immediately, without waiting for the 30-second cache TTL.

Fresh databases also reconcile the invariant that every non-template Agent has one primary Session. Existing primary Sessions are preserved and no duplicate is created.

### Prompt acceptance

The browser owns draft text and image previews until the HTTP Command endpoint returns a valid `202 accepted` receipt. It may render an optimistic human message and running indicator while the request is in flight, but a rejected, timed-out, or malformed response rolls those optimistic changes back and restores the exact draft.

The command boundary accepts text-only, image-only, and mixed prompts. The request-size limit defaults to 16 MiB and is configurable on the server. The browser performs the same limit check before sending and presents a Chinese error without dropping the draft. Inline base64 remains a compatibility path; an attachment upload/reference channel is intentionally deferred.

### Runtime process ownership

Runtime exclusively owns ACP child processes and their in-memory ACP Sessions. It drains child stderr, records contextual warnings, and completely tears down a partially initialized child/router on failure.

An unexpected child exit atomically removes the Agent runtime and all of that Agent's Session bindings, cancels pending permission and elicitation requests, and completes active turns with one error `done`. A later `ensureSession` creates a fresh child and resumes or loads the persisted ACP Session where supported.

All cancel, Session close, Agent stop, child exit, and Runtime shutdown paths resolve pending interactions as cancelled. Cleanup is idempotent.

### Runtime identity and concurrency

Agent reuse is keyed by a stable environment fingerprint rather than serializing the complete environment. Session reuse is keyed by the effective context: cwd, MCP servers, Session metadata, and relevant runtime preferences. A changed fingerprint forces the corresponding runtime or ACP Session to be rebuilt.

Concurrent `ensureSession` calls for one local Session share one in-flight promise. Calls for different Sessions remain independent.

Runtime reports Agent `running`/`standby` and lifecycle progress to API through typed IPC messages. API persists and publishes these states once. Realtime receives visible Session stream events directly from Runtime, so the API bridge must not rebroadcast them.

### ACP update parity

Process Runtime preserves all ACP data already handled by the embedded host: user message chunks, tool title/status/kind/content/diffs/terminal references, progress, terminal output, plan, usage, available commands, Session info, config options, and current mode updates. Capability changes are both retained in Runtime state and published to the browser.

### Realtime recovery

PC and mobile register durable listeners before a connection can send `resume`. Listener registration is independent of transient connection state. A resync resolves the Session's owning project from Session state and refreshes that project, even when it is not the active project.

Disconnects do not unmount the PC global assistant or the mobile application shell. Existing page, draft, and selected Session state remains visible while a reconnect status is shown. Explicit logout/disconnect may still clear credentials according to existing behavior.

### Maintenance and recovery

Process Runtime applies the same idle Session and idle Agent sweep policy as embedded Runtime. Pending turns and interactions prevent eviction.

Durable Command recovery uses deterministic cursor pagination until no recoverable rows remain; it is not capped at 1,000 rows. Recovery preserves existing prompt interruption rules and per-Session lanes.

## Failure Semantics

- No Session creation may rely solely on a later list refresh.
- No Prompt may disappear before the server accepts its durable command.
- No child initialization failure may leave a live process, router, or Session mapping.
- No child exit may leave an interaction promise or active turn unresolved.
- No Realtime reconnect may send resume before application listeners exist.
- No recovery query may silently ignore rows after a fixed limit.

## Verification

Each behavior is implemented test-first. Final acceptance requires all unit and integration tests, build, lint, whitespace checks, the Phase 5 30-Session smoke test, and a same-origin performance-instance smoke test using `19000` and `data-perf`.
