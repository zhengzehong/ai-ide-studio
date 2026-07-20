# Single-Port Edge Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose HTTP and WebSocket traffic through one public `HOST:PORT` while API and Realtime remain isolated on loopback dynamic listeners.

**Architecture:** The production entry point owns a lightweight Edge proxy and supervises an API child. Edge forwards HTTP to the API target and WebSocket Upgrade traffic to the current Realtime target. Typed child IPC publishes initial and restarted targets; same-origin discovery advertises `/realtime` without leaking internal ports.

**Tech Stack:** Node.js child processes and HTTP server, `http-proxy-3`, Hono, ws, TypeScript, Vitest.

---

### Task 1: Edge Proxy Core

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/edge/gateway.ts`
- Test: `tests/integration/edge-gateway.test.ts`

- [x] **Step 1: Add the maintained proxy dependency**

Run:

```powershell
npm install http-proxy-3@1.23.3
```

Use the package's typed `createProxyServer` API. Do not hand-roll HTTP body streaming or WebSocket framing.

- [x] **Step 2: Write failing HTTP and WebSocket proxy tests**

Create two loopback upstream servers and start Edge on `127.0.0.1:0`. The tests must assert:

```ts
expect(await fetch(`${edge.endpointUrl}/health`).then((r) => r.json()))
  .toEqual({ source: 'api' })

const socket = await connect(`${edge.wsEndpointUrl}/realtime?token=owner`)
await expect(nextMessage(socket)).resolves.toEqual({ source: 'realtime' })
```

Add unavailable-target cases:

```ts
edge.updateTargets({})
expect((await fetch(`${edge.endpointUrl}/health`)).status).toBe(503)
await expect(connect(`${edge.wsEndpointUrl}/realtime`)).rejects.toThrow()
```

Run:

```powershell
npx vitest run tests/integration/edge-gateway.test.ts
```

Expected: FAIL because `src/edge/gateway.ts` does not exist.

- [x] **Step 3: Implement the bounded Edge gateway**

Expose this interface:

```ts
export interface EdgeTargets {
  apiUrl?: string
  realtimeUrl?: string
}

export interface EdgeGatewayHandle {
  readonly port: number
  readonly endpointUrl: string
  updateTargets(targets: EdgeTargets): void
  close(): Promise<void>
}

export function startEdgeGateway(options: {
  host: string
  port: number
  targets: EdgeTargets
}): Promise<EdgeGatewayHandle>
```

Requirements:

- preserve Host, query strings, request bodies, streaming responses, `X-Forwarded-*`, and Upgrade headers;
- route all HTTP to `apiUrl` and all Upgrade requests to `realtimeUrl`, retaining root Upgrade compatibility;
- return JSON `503` when a target is unavailable and `502` when proxy connection fails;
- track sockets so `close()` stops intake and closes upgraded connections without waiting forever;
- use `createChildLogger('edge-gateway')` and the Edge event-loop monitor; never log query strings or authorization headers.

- [x] **Step 4: Verify the Edge core**

Run:

```powershell
npx vitest run tests/integration/edge-gateway.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add package.json package-lock.json src/edge/gateway.ts tests/integration/edge-gateway.test.ts
git commit -m "feat: add single-port edge gateway"
```

### Task 2: Same-Origin Discovery And Target Changes

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/gateway/http/realtime-config-route.ts`
- Modify: `src/app.ts`
- Modify: `src/realtime/process-client.ts`
- Test: `tests/integration/realtime-app-lifecycle.test.ts`
- Test: `tests/integration/realtime-process.test.ts`
- Test: `tests/unit/realtime-config-route.test.ts`

- [x] **Step 1: Write failing same-origin discovery tests**

Mount the route with `publicPath: '/realtime'` and assert direct and forwarded authorities:

```ts
expect(await body(request('http://machine:18900/api/v1/realtime-config')))
  .toMatchObject({ wsUrl: 'ws://machine:18900/realtime' })

expect(await body(request('http://internal/api/v1/realtime-config', {
  'x-forwarded-host': 'studio.example.com',
  'x-forwarded-proto': 'https',
}))).toMatchObject({ wsUrl: 'wss://studio.example.com/realtime' })
```

Add a Realtime process restart test that registers an endpoint listener and requires a new callback for the restarted generation.

Run:

```powershell
npx vitest run tests/unit/realtime-config-route.test.ts tests/integration/realtime-process.test.ts
```

Expected: FAIL because public-path discovery and endpoint subscriptions do not exist.

- [x] **Step 2: Add explicit Edge configuration**

Extend `AppConfig`:

```ts
export type EdgeMode = 'process' | 'disabled'

edgeMode?: EdgeMode
edgeRealtimePath?: string
```

`loadConfig()` defaults `EDGE_MODE` to `process` and `EDGE_REALTIME_PATH` to `/realtime`. Reject or normalize paths that do not begin with `/`. `EDGE_MODE=disabled` keeps the old direct listener topology.

- [x] **Step 3: Implement same-origin discovery**

Extend `RealtimeEndpointState` with `publicPath?: string`. When set, construct the authority from `X-Forwarded-Host` or the incoming Host header and append the normalized path. Do not append the internal Realtime port. When absent, retain the current direct endpoint behavior.

- [x] **Step 4: Publish Realtime endpoint changes**

Extend `RealtimeProcessHandle`:

```ts
onEndpointChange(listener: (endpointUrl: string) => void): () => void
```

Invoke listeners after every authenticated `ready` message, including restarts. Listener registration immediately receives the current endpoint when available. Clear listener references on close.

Extend `AppHandle` with the actual internal HTTP endpoint and an endpoint subscription that delegates to process Realtime or emits the embedded API endpoint.

- [x] **Step 5: Verify discovery and restart behavior**

Run:

```powershell
npx vitest run tests/unit/realtime-config-route.test.ts tests/integration/realtime-process.test.ts tests/integration/realtime-app-lifecycle.test.ts
```

Expected: PASS for direct, same-origin, forwarded TLS, process restart, and embedded rollback cases.

- [ ] **Step 6: Commit**

```powershell
git add src/core/config.ts src/gateway/http/realtime-config-route.ts src/app.ts src/realtime/process-client.ts tests/unit/realtime-config-route.test.ts tests/integration/realtime-process.test.ts tests/integration/realtime-app-lifecycle.test.ts
git commit -m "feat: advertise same-origin realtime endpoints"
```

### Task 3: Supervised API Child

**Files:**
- Create: `src/edge/protocol.ts`
- Create: `src/edge/api-entry.ts`
- Create: `src/edge/api-entry-url.ts`
- Create: `src/edge/api-process-client.ts`
- Test: `tests/unit/edge-protocol.test.ts`
- Test: `tests/integration/edge-api-process.test.ts`

- [ ] **Step 1: Write failing protocol and lifecycle tests**

Define tests for strict message guards and a real API child configured with a temporary data directory. Require:

```ts
const api = await createApiProcess({ config })
expect(api.targets.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
expect(api.targets.realtimeUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)
```

Terminate the child, assert an unavailable target notification, wait for a higher generation, and assert new ready targets. Add a test-only API event-loop block command whose acknowledgement arrives only after the requested duration.

Run:

```powershell
npx vitest run tests/unit/edge-protocol.test.ts tests/integration/edge-api-process.test.ts
```

Expected: FAIL because the supervisor modules do not exist.

- [ ] **Step 2: Implement a closed IPC protocol**

Use discriminated messages only:

```ts
type ParentToApiMessage =
  | { type: 'start'; config: AppConfig }
  | { type: 'stop' }
  | { type: 'test.block'; requestId: string; durationMs: number }

type ApiToParentMessage =
  | { type: 'hello' }
  | { type: 'ready'; apiUrl: string; realtimeUrl: string }
  | { type: 'realtime.changed'; realtimeUrl: string }
  | { type: 'test.block.done'; requestId: string }
  | { type: 'stopped' }
  | { type: 'fatal'; message: string }
```

Guards must validate every required field and reject unknown message types. The Edge target never comes from a browser request.

- [ ] **Step 3: Implement API child startup and shutdown**

`api-entry.ts` waits for `start`, calls `startApp(config)`, reports ready targets, subscribes to Realtime endpoint changes, and stops on `stop`, `SIGINT`, `SIGTERM`, or parent IPC disconnect. It uses the shared process-safe logger and never imports Edge proxy code.

- [ ] **Step 4: Implement API supervision**

`createApiProcess()` forks the TS/JS entry, performs the hello/start handshake, exposes immutable target snapshots, notifies listeners, and restarts unexpected exits after a bounded delay. Internalize the supplied config before sending it:

```ts
{
  ...config,
  host: '127.0.0.1',
  port: 0,
  realtimeHost: '127.0.0.1',
  realtimePort: 0,
  edgeRealtimePath: '/realtime',
}
```

`close()` disables restart, sends stop, waits with a timeout, then kills only the owned child if necessary. Process exit clears targets before scheduling restart.

- [ ] **Step 5: Verify supervision**

Run:

```powershell
npx vitest run tests/unit/edge-protocol.test.ts tests/integration/edge-api-process.test.ts
npx tsc --noEmit
```

Expected: PASS with no orphan child after close.

- [ ] **Step 6: Commit**

```powershell
git add src/edge/protocol.ts src/edge/api-entry.ts src/edge/api-entry-url.ts src/edge/api-process-client.ts tests/unit/edge-protocol.test.ts tests/integration/edge-api-process.test.ts
git commit -m "feat: supervise the internal api process"
```

### Task 4: Unified Public Service And Failure Isolation

**Files:**
- Create: `src/edge/supervisor.ts`
- Modify: `src/entry.ts`
- Create: `tests/unit/edge-boundary.test.ts`
- Create: `tests/integration/single-port-service.test.ts`

- [ ] **Step 1: Write failing public-service tests**

Start the supervisor on `127.0.0.1:0` and assert all user traffic uses one authority:

```ts
const discovery = await fetch(`${service.endpointUrl}/api/v1/realtime-config`).then(json)
expect(discovery.wsUrl).toBe(`${service.wsEndpointUrl}/realtime`)
expect(new URL(discovery.wsUrl).port).toBe(new URL(service.endpointUrl).port)
```

Through the public endpoint, verify static/health HTTP, a legacy WS RPC, subscription, ping, and one delivered Session event.

Add failure tests:

- while the API child is synchronously blocked for 150 ms, public WebSocket ping remains below 50 ms;
- Realtime restart changes the internal target but public `wsUrl` stays identical and reconnect succeeds;
- API child termination makes public HTTP return `503`, then recovers on the same public port;
- `service.close()` leaves the child unavailable and closes the public port.

Run:

```powershell
npx vitest run tests/integration/single-port-service.test.ts tests/unit/edge-boundary.test.ts
```

Expected: FAIL because unified supervision is not connected.

- [ ] **Step 2: Implement unified supervision**

Expose:

```ts
export interface UnifiedServiceHandle {
  readonly port: number
  readonly endpointUrl: string
  readonly wsEndpointUrl: string
  blockApiForTest(durationMs: number): Promise<void>
  restartRealtimeForTest(): Promise<void>
  terminateApiForTest(): Promise<void>
  waitForApiRestart(previousGeneration: number): Promise<void>
  close(): Promise<void>
}
```

Startup order is API child ready, Edge listener, target subscription. Shutdown order is Edge intake, target subscription, API child. If Edge startup fails, close the already-started API child.

- [ ] **Step 3: Switch the production entry point**

`src/entry.ts` uses the unified supervisor when `edgeMode !== 'disabled'`. The disabled branch dynamically imports `startApp()` and retains the previous signal handling. Do not statically load Store/Core business modules in Edge mode.

- [ ] **Step 4: Enforce the Edge boundary**

Use a TypeScript AST test over `src/edge/**`. Allow Node built-ins, `http-proxy-3`, `core/config` types, `shared/logger`, `shared/event-loop-monitor`, `app` only from `api-entry.ts`, and local Edge modules. Reject `better-sqlite3`, Store, Core business, Gateway RPC, ACP, Runtime, Realtime implementation, Data Worker, and Hono imports from the public Edge path.

- [ ] **Step 5: Verify public behavior and isolation**

Run:

```powershell
npx vitest run tests/integration/single-port-service.test.ts tests/unit/edge-boundary.test.ts
npx vitest run tests/integration/realtime-performance.test.ts tests/integration/phase-5-process-failures.test.ts
```

Expected: PASS, with the API block not delaying public WebSocket control.

- [ ] **Step 6: Commit**

```powershell
git add src/edge/supervisor.ts src/entry.ts tests/unit/edge-boundary.test.ts tests/integration/single-port-service.test.ts
git commit -m "feat: expose one supervised public port"
```

### Task 5: Deployment Contract, Documentation, And Review

**Files:**
- Modify: `scripts/start-prd-local.ps1`
- Modify: `README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/superpowers/plans/2026-07-20-single-port-edge-gateway.md`

- [ ] **Step 1: Update the deployment surface**

Keep PRD `PORT=18900`, document it as the only public port, and print `Realtime: same-origin /realtime`. Remove user-facing instructions that require `REALTIME_PORT=PORT+1`; document `EDGE_MODE=disabled` as the direct-port rollback.

- [ ] **Step 2: Update stable architecture documentation**

Update the architecture topology and component table with Edge ownership. Update the WS protocol to require dynamic discovery and describe same-origin `/realtime` in Edge mode. Keep implementation phases and acceptance checklists out of architecture documents.

- [ ] **Step 3: Run fresh complete verification**

Run separately:

```powershell
npm test
npm run build
npm run lint
npm run check:ui-bundle
git diff --check
```

Also run a production smoke instance on a free public port and inspect listeners. Only the public Edge listener may bind `0.0.0.0`; internal API and Realtime listeners must bind `127.0.0.1`. Connect HTTP and WebSocket through the public port before stopping the process and confirming all owned listeners disappear.

- [ ] **Step 4: Commit documentation and close the plan**

```powershell
git add scripts/start-prd-local.ps1 README.md docs/architecture/overview.md docs/architecture/ws-protocol.md docs/superpowers/plans/2026-07-20-single-port-edge-gateway.md
git commit -m "docs: document the single public port"
```

- [ ] **Step 5: Request independent code review**

Send the complete base/head range, design spec, acceptance criteria, verification outputs, listener evidence, and rollback behavior to the existing code reviewer. Do not merge into `prd` until the reviewer returns `[REVIEW_APPROVED]` and all P0/P1 findings are resolved.
