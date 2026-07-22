# Session HTTP Path Stability Design

## Goal

Reduce public FRP session-loading latency and restore authenticated history images without changing Session persistence, Runtime ownership, Prompt commands, or Realtime delivery.

## Confirmed Causes

- The public Edge proxy does not reuse its upstream HTTP connection, so normal responses expose `Connection: close` even though the API process supports keep-alive.
- JSON query responses are uncompressed. A recovery response can exceed 500 KiB and must cross the FRP tunnel unchanged.
- Selecting another Session does not abort the previous selection's message and recovery reads.
- `/api/images/*` requires the local token, while native `<img>` requests cannot attach the application's `x-ai-ide-token` header.

## Design

### Edge HTTP Connection Reuse

The Edge owns one `node:http.Agent` with `keepAlive: true` for API proxy traffic. The proxy uses that agent for HTTP requests and destroys it during shutdown. Normal upstream responses must preserve client keep-alive; explicit Edge error responses may still close their connection.

### HTTP Compression

The API applies Hono compression middleware before query and command routes. Compression is negotiated from `Accept-Encoding`, applies only to compressible responses above a threshold, and leaves image streams, WebSocket upgrades, and already encoded responses unchanged. Tests assert response integrity and compressed transfer headers.

### Selection-scoped Query Cancellation

HTTP query methods accept an optional external `AbortSignal`. The client combines it with its deadline signal without changing timeout error semantics. `selectSession` owns one controller for the current selection and aborts it before selecting another Session. Only `messages` and `recovery` reads use this signal; Prompt, cancel, mark-read, and Realtime subscriptions are not cancelled. A monotonically increasing selection generation prevents a stale response from committing if an implementation ignores abort.

### Authenticated Images

History images use an authenticated asset loader that fetches `/api/images/*` with `x-ai-ide-token`, converts successful responses to object URLs, caches them by URL, and revokes them when the cache is disposed. Inline base64 images remain unchanged. Errors render the existing unavailable-image state and do not retry in a render loop. The raw image route remains protected.

## Compatibility

- No database migration.
- No API path changes.
- Existing URL-query token support remains for shared or explicitly tokenized URLs.
- WS and Realtime behavior are unchanged.
- Mobile is not changed unless it imports the shared query type and requires a compile-only adjustment.

## Verification

- Edge integration test proves one upstream socket serves repeated requests and the public response stays keep-alive.
- HTTP query integration test proves a large JSON response is gzip encoded when requested and remains valid JSON after decompression.
- Query-client and Session-store tests prove external abort, timeout distinction, and stale-selection fencing.
- UI image-loader tests prove the token header, Blob URL reuse, failure behavior, and cleanup.
- Full test, lint, build, bundle, and diff checks run before review and merge.
