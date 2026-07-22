# Session HTTP Path Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Session history requests efficient through the public FRP path and load protected history images without 401 responses.

**Architecture:** Keep the public single-port Edge, but reuse API connections and compress large API responses. Scope frontend query cancellation to Session selection and load protected images through an authenticated Blob URL cache.

**Tech Stack:** Node HTTP Agent, http-proxy-3, Hono middleware, React 19, Zustand, Vitest.

---

### Task 1: Preserve HTTP keep-alive through Edge

**Files:**
- Modify: `src/edge/gateway.ts`
- Create: `src/types/http-proxy-3.d.ts`
- Modify: `tests/integration/edge-gateway.test.ts`

- [ ] Add an integration test that sends two requests through one client keep-alive socket and asserts the upstream observes one socket.
- [ ] Run `npx vitest run tests/integration/edge-gateway.test.ts` and confirm the new assertion fails because the proxy closes the connection.
- [ ] Add a keep-alive `http.Agent`, pass it to proxy HTTP requests, strip the upstream hop-by-hop `connection` response header when necessary, and destroy the agent in `close()`.
- [ ] Run the Edge integration test and confirm all cases pass.
- [ ] Commit as `fix(edge): preserve HTTP keep-alive`.

### Task 2: Compress large JSON responses

**Files:**
- Modify: `src/gateway/server.ts`
- Modify: `tests/integration/http-query-routes.test.ts`

- [ ] Add a test that requests a large query response with `Accept-Encoding: gzip`, asserts `Content-Encoding: gzip` and `Vary: Accept-Encoding`, and parses the decompressed body.
- [ ] Run the focused test and confirm it fails with no content encoding.
- [ ] Mount Hono compression before protected HTTP routes with a conservative minimum size, excluding image and preview streams through content-type negotiation.
- [ ] Run focused Gateway/query tests and confirm compressed and uncompressed clients both pass.
- [ ] Commit as `perf(http): compress large API responses`.

### Task 3: Cancel stale Session selection reads

**Files:**
- Modify: `ui/src/services/query-client.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `tests/unit/query-client.test.ts`
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [ ] Add query-client tests for an external abort signal and for deadline abort retaining the timeout error.
- [ ] Add a Session-store test that selects A then B, verifies A's message/recovery signals abort, and verifies a late A response cannot change B.
- [ ] Run both unit test files and confirm the new tests fail.
- [ ] Extend Session message/recovery query inputs with `signal?: AbortSignal`, combine external cancellation with the timeout, and distinguish caller cancellation from deadline timeout.
- [ ] Add a selection controller and generation fence in the Session store; abort on Session change and pass the signal only to selection-triggered messages/recovery.
- [ ] Run the focused unit tests and confirm they pass.
- [ ] Commit as `perf(ui): cancel stale session history reads`.

### Task 4: Load protected history images with authentication

**Files:**
- Create: `ui/src/services/authenticated-image.ts`
- Create: `ui/src/components/chat/AuthenticatedImage.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/global-assistant/GlobalAssistantBubble.tsx`
- Create: `tests/unit/authenticated-image.test.ts`

- [ ] Add tests that verify protected image fetches include `x-ai-ide-token`, successful Blobs reuse an object URL, failures do not cache a URL, and disposal revokes URLs.
- [ ] Run the new test and confirm it fails before the loader exists.
- [ ] Implement a bounded authenticated Blob URL cache using the existing access-token source.
- [ ] Render stored URL attachments through `AuthenticatedImage`; preserve inline base64 behavior and existing visual dimensions.
- [ ] Run image, Session attachment, and UI store tests.
- [ ] Commit as `fix(ui): authenticate history image requests`.

### Task 5: Full verification and merge

**Files:**
- Modify only files required by review findings.

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/check-ui-bundle.mjs`.
- [ ] Run `git diff --check prd...HEAD` and inspect `git status --short`.
- [ ] Request code-reviewer review with BASE=`prd` and HEAD=`fix/session-http-path`.
- [ ] Resolve all P0/P1 findings and rerun affected plus full verification.
- [ ] Merge the reviewed branch into `prd` without restarting the running service.
