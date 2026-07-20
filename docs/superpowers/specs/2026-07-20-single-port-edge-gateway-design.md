# Single-Port Edge Gateway Design

## Goal

AI IDE Studio exposes exactly one public TCP port. `HOST` and `PORT` continue to describe the public service, so the PRD default remains `0.0.0.0:18900`. HTTP, browser assets, mobile access, remote port forwarding, and WebSocket traffic all use that public endpoint.

API and Realtime retain independent Node event loops. Their listeners bind only to `127.0.0.1` on operating-system-assigned ports and are never part of the public deployment contract.

## Selected Approach

The production entry point becomes a lightweight Edge supervisor:

```text
PC / Mobile / Remote access
            |
            | HTTP and WebSocket, public PORT=18900
            v
Edge supervisor process
  owns 0.0.0.0:18900
  no database or business imports
       | HTTP proxy                    | WebSocket proxy /realtime
       v                               v
API child process                 Realtime child process
127.0.0.1:<dynamic>               127.0.0.1:<dynamic>
Core + SQLite ownership           auth/subscriptions/backpressure
       |                               ^
       | Runtime control IPC           | Runtime visible-stream IPC
       v                               |
Runtime child process -----------------+
ACP/session actors/terminals
```

The Edge process uses `http-proxy-3` for HTTP streaming and WebSocket Upgrade forwarding. It performs no authentication, JSON parsing, static-file reads, SQLite access, or domain work. Authentication remains owned by API and Realtime.

## Alternatives Considered

### `REALTIME_MODE=embedded`

HTTP and WebSocket can share the API listener without an Edge. This is retained as a compatibility rollback, but it puts WebSocket serialization and delivery back on the API event loop. It does not meet the isolation requirement.

### External reverse proxy only

Caddy, nginx, or a tunnel can map one public origin to the current two ports. This works for a controlled deployment but makes basic local and remote behavior depend on external configuration. AI IDE Studio must provide the single-port contract itself.

### Built-in Edge supervisor

This is selected. It keeps the public contract simple, preserves independent event loops, works with raw port forwarding, and allows the existing PRD script to stop the complete process tree through the process that owns `18900`.

## Process Ownership

`src/entry.ts` owns the public Edge listener and supervises an API child process. The API child runs `startApp()` with an internal configuration:

- API host: `127.0.0.1`
- API port: `0` (operating-system assigned)
- Realtime host: `127.0.0.1`
- Realtime port: `0` in process mode
- Public Realtime path: `/realtime`

The API child sends a typed IPC readiness message containing its internal HTTP endpoint and current Realtime endpoint. The Edge starts accepting public traffic only after both targets are ready.

If Realtime restarts and receives a different internal port, the API child sends a new endpoint message and Edge atomically updates only the WebSocket target. Existing disconnected clients use their current reconnect and endpoint-discovery behavior.

If the API child exits unexpectedly, Edge keeps the public listener, returns `503` for HTTP and rejects new WebSocket upgrades, then restarts the API child. Once readiness is reported, routing resumes without changing the public address.

On graceful shutdown, Edge stops intake first, closes proxied connections, asks the API child to stop, waits for the existing App shutdown order, and then exits. If the Edge process is forcibly terminated, the API child treats IPC disconnect as a shutdown signal so Realtime, Runtime, Workers, ACP processes, terminals, and SQLite are released.

## Public Routing

Edge preserves the incoming Host and forwarding headers.

| Public request | Internal target |
|---|---|
| HTTP `/*` | API internal endpoint |
| WebSocket Upgrade `/realtime` | Realtime internal endpoint |
| WebSocket Upgrade `/` | Realtime internal endpoint for old-client fallback |
| Other WebSocket Upgrade paths | Realtime internal endpoint; Realtime remains the protocol authority |

The legacy root Upgrade route remains temporarily compatible because PC and mobile fall back to same-origin root WebSocket when endpoint discovery itself fails. The advertised route is always `/realtime`.

## Endpoint Discovery

In Edge mode, `GET /api/v1/realtime-config` uses the request authority instead of an internal port:

```json
{
  "wsUrl": "ws://host:18900/realtime",
  "protocolVersion": "1",
  "legacyRpcEnabled": true,
  "mode": "process"
}
```

When an upstream TLS proxy supplies `X-Forwarded-Proto: https` and `X-Forwarded-Host`, discovery returns `wss://<forwarded-host>/realtime`. No internal port is exposed in HTML, JSON, logs intended for users, PC state, or mobile state.

In direct rollback mode, discovery retains the existing direct Realtime endpoint behavior.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | runtime-dependent | Public Edge bind host |
| `PORT` | `18800` | Public Edge port; PRD script continues to set `18900` |
| `EDGE_MODE` | `process` | `process` uses the Edge supervisor; `disabled` restores direct API/Realtime listeners |
| `EDGE_REALTIME_PATH` | `/realtime` | Public same-origin WebSocket path |
| `REALTIME_MODE` | `process` | Independent Realtime child; `embedded` keeps the explicit compatibility rollback behind Edge |

`REALTIME_HOST` and `REALTIME_PORT` remain meaningful only when `EDGE_MODE=disabled`. Edge mode always forces loopback and dynamic internal listeners.

## Security And Boundaries

- Edge targets are accepted only from the supervised API child over authenticated process ownership; external requests cannot select a proxy target.
- Internal API and Realtime listeners bind to `127.0.0.1`.
- Edge forwards request bodies and headers without logging prompts, tokens, image payloads, or tool output.
- Existing API token guards and Realtime token/share-token authentication remain authoritative.
- An AST boundary test prevents Edge modules from importing Store, Core business modules, Gateway RPC, SQLite, ACP, Runtime, or Data Worker code.
- Proxy errors return `502` when an internal target exists but fails and `503` while the API child is unavailable. Errors use structured Pino logs with target kind, path, and elapsed time, never credentials.

## Observability

Edge has its own event-loop monitor and structured lifecycle logs:

- public host and port
- current API/Realtime target availability without query strings
- active HTTP requests and upgraded connections
- child generation and restart count
- proxy errors and shutdown duration

API, Realtime, and Runtime retain their existing event-loop metrics.

## Compatibility

- PC and mobile continue to call `/api/v1/realtime-config` before every connection and reconnect.
- HTTP Query, HTTP Command, legacy WS RPC, guest shares, owner authentication, cursor resume, resync, and mobile behavior do not change.
- `REALTIME_MODE=embedded` still works, but Edge sends WebSocket Upgrade traffic to the internal API endpoint.
- `EDGE_MODE=disabled` provides an explicit emergency rollback to the current direct-port topology.
- Existing remote mappings need only forward public `18900`; no mapping or firewall rule is required for an internal Realtime port.

## Acceptance Criteria

1. A browser using only public `18900` loads assets, completes an HTTP Query, discovers `ws://same-authority/realtime`, performs a WS RPC, and receives a streamed event.
2. Netstat shows API and Realtime listening only on `127.0.0.1` dynamic ports in Edge mode.
3. Blocking the API child event loop does not delay a public-path Realtime ping beyond the existing realtime latency budget.
4. Realtime restart updates the Edge target without changing the public URL.
5. API child restart produces explicit temporary `503` responses and recovers on the same public port.
6. Stopping the process that owns public `18900` leaves no supervised API, Realtime, Runtime, ACP, or worker process.
7. `EDGE_MODE=disabled` and `REALTIME_MODE=embedded` remain tested rollback paths.
8. Full tests, server/UI/mobile builds, lint, bundle budget, and whitespace checks pass before review.
