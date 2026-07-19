# Local Performance Architecture Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ACP adapters, per-Session stream actors, interaction state, terminal/tool execution, and stream coalescing into one supervised Runtime process without changing existing Session, template, permission, cancellation, PC, mobile, or mock-agent behavior.

**Architecture:** API code calls a transport-neutral `RuntimePort`. In process mode the adapter builds bounded, clone-safe Agent/Session snapshots from API-owned stores and sends commands over framed Protobuf IPC; the Runtime child owns ACP and one serial actor per Session, sends coalesced UI patches directly to Realtime over a second authenticated local pipe, and sends persistence patches/done barriers to API. API remains the SQLite/domain owner, acknowledges `done` only after Writer commit, and preserves `RUNTIME_SERVICE_MODE=embedded` as an explicit rollback.

**Tech Stack:** TypeScript 6, Node.js 24 `child_process`/`net`, ACP SDK, framed Protobuf IPC from Phase 3, Hono, better-sqlite3 Worker Threads, Vitest 4.

---

## Scope And Compatibility Decisions

1. `startApp()` defaults to `RUNTIME_SERVICE_MODE=process`; isolated modules/tests may use `embedded`. The existing `acpHost` remains only behind `EmbeddedRuntimePort` for rollback and old tests.
2. API remains responsible for Session creation, user-message durability, prompt diagnostics, final message/process projection, templates, and domain events. Runtime owns ACP processes, pending permission/elicitation promises, terminal processes, per-Session actor ordering, stream cursors, and coalescing.
3. Runtime never imports `src/store`, `src/core`, `src/gateway`, or `better-sqlite3`. API creates `RuntimeAgentSnapshot` and `RuntimeSessionSnapshot` containing environment, system/session metadata, MCP servers, runtime preferences, project/cwd, persisted ACP id, and auto-permission policy.
4. Runtime sends `session:update` UI patches directly to Realtime with one generation per Runtime ownership and monotonically increasing sequence after coalescing. Persistence patches cross the API channel in the same Session order and carry the same actor cursor; API marks them `source: runtime-persistence` so they are not echoed to Realtime.
5. Runtime sends a done barrier only after flushing its UI and persistence coalescers. API processes all preceding patches, emits `session:done`, waits for `sessionManager.waitForPersistence`, and replies; the committed done with the Runtime cursor then follows the existing `session:committed_done -> Realtime` path.
6. Child crash does not kill API/Realtime. The API-side client tracks active Session ownership, emits one interrupted/error completion per active turn, clears pending prompt state, and restarts Runtime. A restarted Runtime creates a new generation and reloads a fresh snapshot before the next command.
7. Phase 4 preserves legacy WS commands through `RuntimePort`; browser Command HTTP migration and durable runtime-command replay are Phase 5 scope. No database dual-write or second Runtime shard is introduced.

## File Map

- Create `src/ports/runtime-port.ts`: async Runtime command contract and clone-safe snapshots.
- Create `src/runtime/runtime-port-provider.ts`: active adapter registration and reset lifecycle.
- Create `src/runtime/api/runtime-snapshot.ts`: API-only Store/model/tool projection into Runtime snapshots.
- Create `src/runtime/api/embedded-runtime-port.ts`: current `acpHost` rollback adapter.
- Create `src/runtime/api/process-runtime-port.ts`: child supervision, control RPC, ordered persistence ingress, crash handling, and restart.
- Create `src/runtime/service/entry-url.ts`: source/build child entry resolution.
- Create `src/runtime/service/entry.ts`: API and Realtime pipe bootstrap.
- Create `src/runtime/service/service.ts`: Runtime command dispatcher and lifecycle.
- Create `src/runtime/service/acp-runtime-host.ts`: database-free ACP/mock host.
- Create `src/runtime/service/acp-runtime-client.ts`: database-free ACP callbacks, interaction state, terminal/tool bridge, and event normalization.
- Create `src/runtime/actors/session-actor.ts`: serial per-Session actor and cursor owner.
- Create `src/runtime/streams/runtime-update-coalescer.ts`: 25ms UI and 250ms persistence coalescers with critical flush.
- Create `src/runtime/resources/resource-governor.ts`: bounded turn/CPU/disk permits.
- Create `src/realtime/runtime-stream-ingress.ts`: authenticated framed Runtime stream pipe owned by Realtime.
- Modify `src/realtime/process-client.ts`, `src/realtime/entry.ts`, and `src/realtime/service.ts`: create and consume direct Runtime stream ingress.
- Modify `src/core/events.ts` and `src/gateway/realtime-event-source.ts`: tag and suppress persistence-only Runtime patches.
- Modify `src/core/persistence/session-persistence-port.ts`, `src/ports/write-data-port.ts`, and Writer Worker modules: seed ordering and derive done outbox version from the committed event sequence.
- Modify `src/core/sessions.ts`, `src/core/session-templates.ts`, and `src/gateway/rpc/sessions.ts`: call `RuntimePort`, remove external inspection of ACP connection internals, and await interaction commands.
- Modify `src/app.ts` and `src/core/config.ts`: Runtime mode/config/start/stop/restart ownership.
- Update `docs/architecture/overview.md`, `docs/architecture/ws-protocol.md`, `docs/architecture/acp-session-lifecycle.md`, and `README.md`.

## Task 1: Runtime Contract, Snapshot Adapter, And Rollback Port

**Files:**
- Create: `src/ports/runtime-port.ts`
- Create: `src/runtime/runtime-port-provider.ts`
- Create: `src/runtime/api/runtime-snapshot.ts`
- Create: `src/runtime/api/embedded-runtime-port.ts`
- Test: `tests/unit/runtime-snapshot.test.ts`
- Test: `tests/unit/runtime-port-provider.test.ts`

- [x] **Step 1: Write failing contract/snapshot tests**

Seed Agent, model profile/provider, Project, Session runtime preferences, Team membership, Agent Memory, and tool visibility. Assert the snapshot is clone-safe and contains no Store row methods or database handles:

```ts
const snapshot = buildRuntimeStateSnapshot({ sessionId })
expect(snapshot.agent).toMatchObject({ id: agent.id, runtime: 'mock' })
expect(snapshot.session).toMatchObject({ id: session.id, projectId: project.id, cwd: project.work_dir })
expect(snapshot.runtimePreferences).toEqual({ modelId: 'mock-smart', modeId: 'plan', config: {} })
expect(snapshot.mcpServers).toEqual(expect.any(Array))
expect(() => structuredClone(snapshot)).not.toThrow()
```

Test provider install/reset and verify the embedded adapter delegates ensure/prompt/cancel/fork/config/capabilities/interaction/close/stop calls to `acpHost` without exposing `acpHost.agents`.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/unit/runtime-snapshot.test.ts tests/unit/runtime-port-provider.test.ts`

Expected: FAIL because the Runtime Port and snapshot modules do not exist.

- [x] **Step 3: Define the closed Runtime contract**

Define clone-safe snapshots and the complete async surface:

```ts
export interface RuntimePort {
  ensureSession(snapshot: RuntimeStateSnapshot, options?: { emitLifecycle?: boolean }): Promise<string>
  prompt(input: RuntimePromptInput): Promise<void>
  cancelPrompt(agentId: string, sessionId: string): Promise<void>
  closeSession(agentId: string, sessionId: string): Promise<void>
  forkSession(snapshot: RuntimeStateSnapshot, sourceAcpSessionId: string): Promise<string>
  setModel(agentId: string, sessionId: string, modelId: string): Promise<void>
  setMode(agentId: string, sessionId: string, modeId: string): Promise<void>
  setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void>
  getSessionCapabilities(agentId: string, sessionId: string): Promise<SessionCapabilities | undefined>
  resolvePermission(sessionId: string, requestId: string, optionId?: string, cancelled?: boolean): Promise<boolean>
  resolveElicitation(sessionId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: ElicitationContent): Promise<boolean>
  drain(): Promise<void>
  close(): Promise<void>
}
```

Snapshots include plain Agent fields, runtime env, runtime command, session meta, ACP resume id, cwd/project, MCP server DTOs, saved preferences, and auto-approved internal Team tool names.

- [x] **Step 4: Implement API snapshot and embedded adapter**

Keep every Store/model/tool import under `src/runtime/api/**`. Resolve secrets only into the child environment payload; structured logs continue to hash/redact credentials. `EmbeddedRuntimePort` wraps the current host and owns the old cancel watchdog internally so call sites no longer inspect `AgentConnection`.

- [x] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/runtime-snapshot.test.ts tests/unit/runtime-port-provider.test.ts tests/integration/mock-capabilities.test.ts tests/integration/acp-prompt-completion.test.ts`

Commit: `refactor(runtime): introduce runtime port and snapshots`

## Task 2: Session Actors, Coalescing, Resource Governor, And Persistence Cursor

**Files:**
- Create: `src/runtime/actors/session-actor.ts`
- Create: `src/runtime/streams/runtime-update-coalescer.ts`
- Create: `src/runtime/resources/resource-governor.ts`
- Modify: `src/core/persistence/session-persistence-port.ts`
- Modify: `src/ports/write-data-port.ts`
- Modify: `src/data-worker/writer-worker/client.ts`
- Modify: `src/data-worker/writer-worker/operations.ts`
- Test: `tests/unit/runtime-session-actor.test.ts`
- Test: `tests/unit/runtime-update-coalescer.test.ts`
- Test: `tests/unit/runtime-resource-governor.test.ts`
- Test: `tests/integration/session-persistence-seed.test.ts`

- [x] **Step 1: Write failing actor/coalescer tests**

Assert one Session is strictly serial, 30 active Sessions rotate fairly, generation is stable for one ownership, sequence increments only for emitted logical patches, text deltas concatenate, process progress is latest-wins, and permission/elicitation/terminal tool status/done flush pending patches first. A queue over its item/byte limit rejects a new turn with `RUNTIME_BACKPRESSURE` but retains already accepted critical work.

- [x] **Step 2: Write failing governor and persistence tests**

Use controllable promises to assert 32 network turns, `max(2, floor(cpus/2))` CPU-heavy terminals, and two disk-heavy terminals; releasing one permit wakes the oldest waiter. Seed a Session with existing events and assert the next embedded Writer batch starts above the persisted cursor and `outbox_events.version` equals the actual committed `message.done` event sequence.

- [x] **Step 3: Run RED**

Run: `npx vitest run tests/unit/runtime-session-actor.test.ts tests/unit/runtime-update-coalescer.test.ts tests/unit/runtime-resource-governor.test.ts tests/integration/session-persistence-seed.test.ts`

- [x] **Step 4: Implement actor/coalescer/governor**

Use one round-robin scheduler with a bounded per-Session mailbox. The coalescer emits UI patches at 25ms and persistence patches at 250ms; it never merges across message/tool IDs. `flushSession()` awaits accepted persistence writes before returning the terminal cursor. Resource permits use FIFO waiters and support cancellation during Runtime shutdown.

- [x] **Step 5: Seed persistence ordering and outbox version**

Extend the Writer protocol with a read-only `sessionCursor(sessionId)` operation executed on the Writer connection before the first embedded batch. Cache one initialization promise per Session. For a batch containing `session.event.append` followed by `outbox.enqueue` with no explicit version, Writer uses the appended event result sequence; retries remain idempotent by `batchId`.

- [x] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/runtime-session-actor.test.ts tests/unit/runtime-update-coalescer.test.ts tests/unit/runtime-resource-governor.test.ts tests/integration/session-persistence-seed.test.ts tests/integration/writer-worker.test.ts tests/unit/writer-worker-scheduler.test.ts`

Commit: `feat(runtime): add actors coalescing and resource limits`

## Task 3: Database-Free Runtime Child And Direct Realtime Stream

**Files:**
- Create: `src/runtime/service/entry-url.ts`
- Create: `src/runtime/service/entry.ts`
- Create: `src/runtime/service/service.ts`
- Create: `src/runtime/service/acp-runtime-host.ts`
- Create: `src/runtime/service/acp-runtime-client.ts`
- Create: `src/realtime/runtime-stream-ingress.ts`
- Modify: `src/realtime/process-client.ts`
- Modify: `src/realtime/entry.ts`
- Modify: `src/realtime/service.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/integration/runtime-process.test.ts`
- Test: `tests/integration/runtime-realtime-stream.test.ts`

- [x] **Step 1: Write failing Runtime process tests**

Start real Realtime and Runtime children on ephemeral pipe/ports. With the mock adapter, verify ready handshake, ensure/new/resume, two concurrent Sessions, prompt stream, capability query, model/mode change, cancel, permission/elicitation response, fork, close, and clean drain. Block API for 150ms after a prompt starts and use a separate WebSocket probe to verify coalesced stream patches continue.

- [x] **Step 2: Write failing direct-stream and done-barrier tests**

Assert Runtime stream envelopes reach only subscribed clients with Runtime-assigned generation/sequence; no API `session:update` broadcast is required. Hold the API done acknowledgement and verify `session:done` is absent; release it and verify done arrives after all patches with the terminal cursor.

- [x] **Step 3: Run RED**

Run: `npx vitest run tests/integration/runtime-process.test.ts tests/integration/runtime-realtime-stream.test.ts`

- [x] **Step 4: Implement authenticated dual IPC**

API control uses the existing framed envelope with request IDs/deadlines. Realtime owns a second named-pipe/Unix-socket server and validates a separate one-time Runtime token before accepting `stream.patch`. Both channels use bounded serialized writes and fail accepted requests explicitly on close; no Node object, callback, Error instance, or socket crosses IPC.

- [x] **Step 5: Implement the child ACP host**

The child consumes only snapshots and pure ACP helpers. It spawns Claude/Codex/mock adapters, owns ACP session maps and interactions, applies saved preferences, uses snapshot MCP servers/auto-permission policy, and routes terminal creation through `ResourceGovernor`. It must not import existing store-bound `acp/host.ts`, `model-profile-env.ts`, or `session-capabilities.ts`.

- [x] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/integration/runtime-process.test.ts tests/integration/runtime-realtime-stream.test.ts tests/integration/realtime-process.test.ts tests/integration/realtime-performance.test.ts`

Commit: `feat(runtime): run acp ownership in child process`

## Task 4: API Ingress, Call-Site Migration, Lifecycle, And Crash Recovery

**Files:**
- Create: `src/runtime/api/process-runtime-port.ts`
- Modify: `src/core/events.ts`
- Modify: `src/gateway/realtime-event-source.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/core/session-templates.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Modify: `src/app.ts`
- Modify: `src/core/config.ts`
- Test: `tests/integration/runtime-app-lifecycle.test.ts`
- Test: `tests/integration/runtime-command-parity.test.ts`
- Test: `tests/integration/runtime-crash-recovery.test.ts`

- [x] **Step 1: Write failing parity/lifecycle tests**

Run identical mock Session workflows through embedded and process adapters and compare persisted user/agent messages, events, process items, capabilities, model/mode/config, fork/template, cancel, permission/elicitation, status/activity, and final `session:done`. Assert startup order Writer -> Query -> Realtime -> Runtime -> Gateway and shutdown order command intake -> Runtime drain -> Realtime -> HTTP -> Writer drain.

- [x] **Step 2: Write failing crash tests**

Kill Runtime during two active prompts. Assert API HTTP Query remains 200, Realtime remains connected, each active Session gets one persisted interrupted/error completion, no active prompt leaks, child restarts with a higher generation, and a new prompt reloads snapshot/resumes ACP or starts a clean session.

- [x] **Step 3: Run RED**

Run: `npx vitest run tests/integration/runtime-app-lifecycle.test.ts tests/integration/runtime-command-parity.test.ts tests/integration/runtime-crash-recovery.test.ts`

- [x] **Step 4: Implement ordered API persistence ingress**

Chain `runtime.persistence.patch` and `runtime.done` by Session in receive order. Persistence patches emit `session:update` with `source: 'runtime-persistence'`; `createRealtimeEventSource` ignores only those update frames. Done includes Runtime generation/sequence, flushes all prior API persistence, and receives its RPC ack only after `sessionManager.waitForPersistence()` resolves.

- [x] **Step 5: Migrate all external ACP callers to RuntimePort**

Replace imports in `sessions.ts`, `session-templates.ts`, and Gateway Session RPC. Permission/elicitation become awaited commands; cancel watchdog moves behind the port; no caller reads `AgentConnection`, runtime Session maps, or active turn keys. Existing tests that intentionally exercise embedded ACP may inject `embeddedRuntimePort`.

- [x] **Step 6: Wire config, supervision, and recovery**

Add `RUNTIME_SERVICE_MODE`, queue/byte/deadline/coalesce/resource limits, and explicit embedded rollback. Runtime unexpected exit calls one API recovery callback with tracked active Session IDs; the callback clears prompt diagnostics/state and emits one error done. Restart never silently falls back to embedded.

- [x] **Step 7: Run GREEN and commit**

Run: `npx vitest run tests/integration/runtime-app-lifecycle.test.ts tests/integration/runtime-command-parity.test.ts tests/integration/runtime-crash-recovery.test.ts tests/integration/acp-prompt-completion.test.ts tests/integration/mock-capabilities.test.ts tests/unit/acp-lifecycle-state.test.ts`

Commit: `feat(app): supervise runtime service lifecycle`

## Task 5: Boundary Gates, Documentation, And Phase Verification

**Files:**
- Create: `tests/unit/runtime-boundary.test.ts`
- Modify: `tests/unit/database-access-boundary.test.ts`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/acp-session-lifecycle.md`
- Modify: `README.md`
- Modify: this plan

- [x] **Step 1: Add AST boundary gates**

Fail if `src/runtime/service/**`, `src/runtime/actors/**`, `src/runtime/streams/**`, or `src/runtime/resources/**` imports Store, Core, Gateway, Hono, better-sqlite3, Query/Writer workers, or the store-bound embedded `acpHost`. Permit Store access only in `src/runtime/api/runtime-snapshot.ts` and embedded adapter; require Runtime process files to use `src/shared/logger.ts`.

- [x] **Step 2: Update stable architecture docs**

Document the three event loops, Runtime ownership, snapshots, direct stream pipe, persistence/done barrier, resource limits, crash/interrupted behavior, lifecycle order, observability, and `RUNTIME_SERVICE_MODE=embedded` rollback. Architecture docs contain no phase checklist or implementation status.

- [x] **Step 3: Run 30-Session phase checks**

Use 30 mock Sessions with simultaneous prompts. Acceptance: API `/health` and HTTP Query p95 below 100ms during streaming, healthy WebSocket patch p95 below 50ms, actor mailbox and both IPC queues remain under configured limits, Writer queue drains, all 30 done events persist exactly once, and Runtime kill/restart leaves zero active-turn/terminal/interaction leaks.

- [x] **Step 4: Run full verification**

```bash
npm test
npm run build
npm run lint
git diff --check 02469f9..HEAD
git status --short
```

- [x] **Step 5: Request code review and report Phase 4**

Review range is `02469f9..HEAD`. Do not merge `prd`; Phase 5 starts only after approval.

Commit: `docs: document runtime process ownership`

## Self-Review

- Spec coverage: ACP Host, Session actor, tool/terminal runtime, visible/persistence coalescing, direct Realtime stream, persistence ack, resource governor, process lifecycle, interrupted recovery, boundary gates, rollback, and 30-Session evidence each map to a task.
- Compatibility: Session/domain persistence remains in API; current mock/Claude/Codex ACP behavior and legacy WS commands continue through `RuntimePort`.
- Dependency direction: only API adapters read Stores; Runtime service depends on Ports/contracts/shared/ACP SDK and cannot open SQLite or import Core/Gateway.
- Consistency: one Runtime actor owns generation/sequence; Realtime never renumbers; Writer/outbox commit is the done visibility barrier.
- Non-goals: no second Runtime shard, no Redis/broker, no Rust rewrite, no Query/Command process split, and no browser Command HTTP migration in this phase.
