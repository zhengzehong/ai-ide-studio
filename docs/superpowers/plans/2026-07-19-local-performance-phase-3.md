# Local Performance Architecture Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WebSocket ownership, subscription indexes, outbound serialization, and backpressure into one independent Realtime process while preserving every current PC, mobile, widget, and guest-share behavior through an explicit legacy RPC compatibility bridge.

**Architecture:** The API process supervises a Realtime child and communicates over a local length-prefixed Protobuf envelope carried by a named pipe on Windows or Unix domain socket elsewhere. Realtime owns all browser sockets and never imports Store, Core domain managers, or SQLite. API domain/runtime events flow to Realtime through a typed event sink; non-realtime WS messages are proxied back to the API only while `REALTIME_LEGACY_RPC=enabled`. The browser discovers the actual endpoint from HTTP so no client hard-codes the new port.

**Tech Stack:** TypeScript 6, Node.js 24 `child_process`/`net`, `ws` 8, Hono, React 19, Zustand, Vitest 4.

---

## Scope And Compatibility Decisions

1. `startApp()` defaults to `REALTIME_MODE=process`. `REALTIME_MODE=embedded` is an explicit rollback mode and remains the default only for isolated `startGateway()` tests that do not start the application supervisor.
2. Realtime accepts only `subscribe`, `unsubscribe`, `resume`, and `ping` locally. Every other legacy frame is rejected when `REALTIME_LEGACY_RPC=disabled`; when enabled it crosses the IPC bridge and executes in the API process. This compatibility switch must be visible in logs and the HTTP discovery response.
3. Realtime authentication asks the API over IPC. Owner tokens are compared against API config; guest share tokens are resolved in API and returned as short-lived connection claims. Realtime never imports `sessionShareStore`.
4. Existing ServerMessage names remain unchanged in Phase 3. The Realtime hub tracks optional `streamGeneration`/`sequence` fields when present and supports `resync_required`; Phase 4 makes Runtime the real cursor producer.
5. The existing PC and mobile `wsClient.request()` API remains source-compatible. Endpoint discovery changes connection bootstrapping, not Store call sites.
6. The IPC schema is closed and versioned. Payload data is JSON inside Protobuf field 12, but framing and metadata are language-neutral and can be consumed by a future Rust service without Node IPC.

## File Map

- Create `src/ipc/protobuf-envelope.ts`: minimal Protobuf encoder/decoder for the architecture envelope.
- Create `src/ipc/framed-socket.ts`: 4-byte big-endian framing, bounded frame parsing, drain-aware writes, and close semantics.
- Create `src/realtime/protocol.ts`: clone/JSON-safe Realtime IPC message union and connection claims.
- Create `src/realtime/outbound-queue.ts`: bounded per-connection queue with stream coalescing and critical-frame preservation.
- Create `src/realtime/hub.ts`: socket registry, session subscription index, guest filtering, cursor/gap detection, and resync.
- Create `src/realtime/service.ts`: HTTP/WebSocket lifecycle plus API IPC routing.
- Create `src/realtime/entry.ts`: child-process entrypoint.
- Create `src/realtime/process-client.ts`: API-side process supervision, readiness, RPC/auth dispatch, event send, drain, and stop.
- Create `src/realtime/entry-url.ts`: `.ts`/`.js` child entry resolution.
- Create `src/gateway/realtime-event-source.ts`: map mitt events to transport-neutral Realtime deliveries.
- Create `src/gateway/realtime-rpc-bridge.ts`: execute legacy WS RPC in API with mirrored client state.
- Create `src/gateway/http/realtime-config-route.ts`: dynamic endpoint discovery.
- Modify `src/gateway/ws-handler.ts`: keep only embedded compatibility connection handling and remove module-scope event subscriptions.
- Modify `src/gateway/server.ts`: optional embedded WebSocket mounting and dynamic Realtime config route.
- Modify `src/app.ts`: start/stop Realtime around Gateway and data ports.
- Modify `src/core/config.ts`: Realtime mode/host/port, IPC limits, backpressure limits, and legacy RPC switch.
- Modify `src/types/ws-protocol.ts`: realtime control/resync message contracts and optional cursor metadata.
- Create `ui/src/services/realtime-endpoint.ts`: authenticated HTTP discovery with same-origin fallback.
- Modify `ui/src/stores/connection.store.ts`: async endpoint discovery before connect/reconnect.
- Modify `ui/src/services/ws-client.ts`: endpoint resolver, ping/resume, cursor tracking, and resync event.
- Modify `mobile/src/stores/connection.store.ts`: discover endpoint from configured API URL with fallback.
- Update `docs/architecture/overview.md`, `docs/architecture/ws-protocol.md`, `README.md`.

## Task 1: Length-Prefixed Protobuf IPC

**Files:**
- Create: `src/ipc/protobuf-envelope.ts`
- Create: `src/ipc/framed-socket.ts`
- Test: `tests/unit/ipc-protobuf-envelope.test.ts`
- Test: `tests/integration/ipc-framed-socket.test.ts`

- [x] **Step 1: Write failing codec and framing tests**

Cover all envelope metadata, unknown-field skipping, partial header/body reads, multiple frames in one chunk, a frame larger than the configured maximum, socket backpressure, and close rejecting new sends.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/unit/ipc-protobuf-envelope.test.ts tests/integration/ipc-framed-socket.test.ts`

Expected: FAIL because the IPC modules do not exist.

- [x] **Step 3: Implement the closed envelope codec**

Use these fields and no arbitrary object transport:

```text
1 version:string
2 kind:string
3 requestId:string
4 timestamp:uint64
5 deadlineMs:uint64
6 projectId:string
7 sessionId:string
8 streamGeneration:string
9 sequence:uint64
10 batchId:string
11 idempotencyKey:string
12 payload:bytes (UTF-8 JSON)
```

Reject missing version/kind, unsafe integers, payloads above the configured limit, malformed varints, truncated length-delimited fields, and non-object JSON payloads.

- [x] **Step 4: Implement framed socket transport**

Prefix encoded envelopes with a 4-byte big-endian length. Buffer partial reads, enforce `maxFrameBytes`, serialize writes, and await socket `drain` when `write()` returns false. `close()` stops intake, drains accepted writes, ends the socket, and is idempotent.

- [x] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/ipc-protobuf-envelope.test.ts tests/integration/ipc-framed-socket.test.ts`

Commit: `feat(ipc): add framed protobuf service transport`

## Task 2: Realtime Hub, Subscription Index, And Backpressure

**Files:**
- Create: `src/realtime/protocol.ts`
- Create: `src/realtime/outbound-queue.ts`
- Create: `src/realtime/hub.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/unit/realtime-outbound-queue.test.ts`
- Test: `tests/unit/realtime-hub.test.ts`

- [x] **Step 1: Write failing queue tests**

Assert bounded message/byte capacity, same-message text delta concatenation, same process-item progress latest-wins, FIFO for critical frames, and overflow producing exactly one `resync_required` while subsequent noncritical deltas are suppressed.

- [x] **Step 2: Write failing hub tests**

Assert project/session subscription isolation, guest session restriction, hidden guest tool calls, global delivery, unsubscribed sessions avoiding JSON serialization, `ping -> pong`, resume acknowledgement, generation change/gap resync, and disconnect cleanup.

- [x] **Step 3: Run RED**

Run: `npx vitest run tests/unit/realtime-outbound-queue.test.ts tests/unit/realtime-hub.test.ts`

Expected: FAIL because the Realtime queue and hub do not exist.

- [x] **Step 4: Implement queue and hub**

The hub stores one connection record and reverse session index. Every connection owns one `OutboundQueue`. Serialization occurs only after a matching subscriber is found. Critical frames (`session:done`, permission/elicitation prompts, error, resync) are never silently dropped; if they cannot fit after evicting coalescible frames, close the connection with 1013 after queuing resync.

- [x] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/realtime-outbound-queue.test.ts tests/unit/realtime-hub.test.ts tests/unit/ws-handler-guest-filter.test.ts tests/unit/ws-broadcast.test.ts`

Commit: `feat(realtime): add bounded subscription hub`

## Task 3: Independent Realtime Process And API Bridge

**Files:**
- Create: `src/realtime/entry-url.ts`
- Create: `src/realtime/service.ts`
- Create: `src/realtime/entry.ts`
- Create: `src/realtime/process-client.ts`
- Create: `src/gateway/realtime-event-source.ts`
- Create: `src/gateway/realtime-rpc-bridge.ts`
- Modify: `src/gateway/ws-handler.ts`
- Modify: `src/gateway/rpc/types.ts`
- Test: `tests/integration/realtime-process.test.ts`
- Test: `tests/integration/realtime-legacy-rpc.test.ts`

- [x] **Step 1: Write failing process tests**

Start a real child on an ephemeral WebSocket port and named-pipe/Unix-socket IPC endpoint. Verify ready handshake, owner and guest auth callbacks, session/global event delivery, independent event-loop progress while API blocks for 150ms, process termination closing sockets, restart on the same configured port, and clean stop with no child handle.

- [x] **Step 2: Write failing legacy bridge tests**

Verify `subscribe/unsubscribe/resume/ping` stay local; `sessions.list` and one mutating RPC cross to API and preserve requestId/result/error; subscription mutations made by session create/fork are mirrored back; disabled compatibility returns an explicit error without invoking API.

- [x] **Step 3: Run RED**

Run: `npx vitest run tests/integration/realtime-process.test.ts tests/integration/realtime-legacy-rpc.test.ts`

Expected: FAIL because the service/process bridge does not exist.

- [x] **Step 4: Implement event source and RPC bridge**

`createRealtimeEventSource(sink)` owns all mitt listeners and the session update broadcast batcher. API RPC dispatch receives a reconstructed `RpcClientState`, streams response frames back over IPC, and returns the final subscription set. No WebSocket object crosses IPC.

- [x] **Step 5: Implement process lifecycle**

The API opens the framed IPC server, forks the child, validates the one-time internal handshake token, waits for child readiness, and exposes the actual WS port. Unexpected exit marks Realtime unavailable and schedules a bounded restart; explicit stop cancels restart, requests drain, then terminates after timeout.

- [x] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/integration/realtime-process.test.ts tests/integration/realtime-legacy-rpc.test.ts tests/integration/ws-capabilities.test.ts tests/integration/ws-fork.test.ts tests/integration/ws-copy-session.test.ts`

Commit: `feat(realtime): run websocket ownership in child process`

## Task 4: App Lifecycle And Dynamic Client Discovery

**Files:**
- Create: `src/gateway/http/realtime-config-route.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/app.ts`
- Modify: `src/core/config.ts`
- Create: `ui/src/services/realtime-endpoint.ts`
- Modify: `ui/src/stores/connection.store.ts`
- Modify: `ui/src/services/ws-client.ts`
- Modify: `mobile/src/stores/connection.store.ts`
- Test: `tests/integration/realtime-app-lifecycle.test.ts`
- Test: `tests/unit/pc-connection-auth.test.ts`
- Test: `tests/unit/mobile-connection-store.test.ts`
- Test: `tests/unit/ws-client.test.ts`

- [x] **Step 1: Write failing app/discovery tests**

Assert `startApp` starts process Realtime before returning, `/api/v1/realtime-config` reports the actual endpoint and compatibility flag, browser/mobile discovery carries access or share auth, discovery failure falls back to same-origin embedded WS, reconnect re-runs discovery, and stop closes API/Realtime/Workers in order.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/integration/realtime-app-lifecycle.test.ts tests/unit/pc-connection-auth.test.ts tests/unit/mobile-connection-store.test.ts tests/unit/ws-client.test.ts`

- [x] **Step 3: Wire config and lifecycle**

Add `REALTIME_MODE`, `REALTIME_HOST`, `REALTIME_PORT`, `REALTIME_LEGACY_RPC`, `REALTIME_MAX_QUEUE_MESSAGES`, `REALTIME_MAX_QUEUE_BYTES`, `REALTIME_MAX_BUFFERED_BYTES`, and `REALTIME_IPC_MAX_FRAME_BYTES`. Default process port is API port + 1; API port 0 implies Realtime port 0. Embedded rollback retains the old shared-port behavior.

- [x] **Step 4: Implement endpoint discovery and reconnect**

PC requests same-origin discovery; mobile requests the configured API base. The returned URL is authoritative. `wsClient` accepts an async URL resolver so reconnect never reuses an expired or changed endpoint blindly. Existing direct `connect(string)` remains supported for isolated tests and embedded callers.

- [x] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/integration/realtime-app-lifecycle.test.ts tests/integration/data-worker-lifecycle.test.ts tests/unit/pc-connection-auth.test.ts tests/unit/mobile-connection-store.test.ts tests/unit/ws-client.test.ts`

Commit: `feat(app): discover and supervise realtime service`

## Task 5: Boundary Gates, Documentation, And Phase Verification

**Files:**
- Create: `tests/unit/realtime-boundary.test.ts`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `README.md`
- Modify: this plan

- [x] **Step 1: Add boundary test**

Use TypeScript AST imports to fail if `src/realtime/**` imports `src/store`, `src/core`, `better-sqlite3`, or Gateway RPC modules. Also fail if API event-source code imports `ws` or Realtime child imports Hono/domain stores.

- [x] **Step 2: Update stable docs**

Document physical process ownership, framed IPC envelope, dynamic endpoint, backpressure/resync, explicit compatibility switch, lifecycle, observability, and rollback. Architecture docs describe the stable structure; this file alone tracks implementation status.

- [x] **Step 3: Run fault/performance checks**

Measure 30 subscribed Session streams, one deliberately stalled client, API 150ms blocking diagnostic, Realtime restart, and HTTP query continuity. Acceptance: healthy clients p95 delivery below 50ms on the local test machine, stalled client bounded by configured bytes, HTTP timer gap independent of Realtime serialization, and no lost critical done frame.

- [x] **Step 4: Run full verification**

```bash
npm test
npm run build
npm run lint
git diff --check a287fb2..HEAD
git status --short
```

Expected: all pass and worktree clean after commits.

- [x] **Step 5: Request code review and report Phase 3**

Review range is `a287fb2..HEAD`. Do not merge `prd`; do not start Phase 4 until Phase 3 is approved.

Commit: `docs: document realtime process ownership`

## Self-Review

- Spec coverage: separate Realtime process, WebSocket ownership, subscriptions, bounded queues, cursor/gap handling, dynamic endpoint, API/Runtime event IPC, failure restart, and compatibility rollback each have an implementation and test task.
- Compatibility: old PC/mobile RPC behavior is preserved only through the named compatibility bridge; local Realtime control frames do not execute domain code.
- Boundary: Realtime receives claims and events over IPC and has no DB/Core imports.
- Protocol: the plan uses one versioned envelope and consistent field names across codec, process client, service, and docs.
- Non-goals: Phase 3 does not move ACP/Session actors, does not create a second Realtime instance, and does not migrate all Commands to HTTP before equivalent endpoints exist.
