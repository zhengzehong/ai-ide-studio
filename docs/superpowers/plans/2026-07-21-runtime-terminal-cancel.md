# Runtime Terminal Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stop Generation immediately understandable to the user and guarantee that the owned Runtime turn reaches one terminal `cancelled` result before a replacement prompt starts.

**Architecture:** Process Runtime sessions receive platform tools only through the API-owned HTTP MCP endpoint, with one stable tool token per unchanged Session context. The Runtime child owns active-turn identity and cancellation escalation; the API no longer fabricates terminal events. PC stores expose a stopping state immediately and deduplicate repeated cancel clicks while preserving the next draft.

**Tech Stack:** TypeScript 6, Hono, ACP SDK, MCP SDK, React 19, Zustand, Vitest.

---

### Task 1: Unify process Runtime ownership

**Files:**
- Modify: `src/ports/runtime-port.ts`
- Modify: `src/runtime/runtime-port-provider.ts`
- Modify: `src/runtime/api/process-runtime-port.ts`
- Modify: `src/runtime/api/runtime-snapshot.ts`
- Modify: `src/tools/registry/context-registry.ts`
- Modify: `src/tools/resolver.ts`
- Modify: all `buildRuntimeStateSnapshot` callers under `src/core/` and `src/gateway/rpc/`
- Test: `tests/unit/runtime-snapshot.test.ts`
- Test: `tests/unit/tool-context-registry.test.ts`
- Test: `tests/unit/tool-gateway-resolver.test.ts`

- [ ] Add a failing snapshot test proving the active process Runtime selects HTTP MCP without each caller knowing transport details.
- [ ] Add a failing registry/resolver test proving repeated unchanged Session snapshots reuse the same bearer token and changed visibility rotates it.
- [ ] Run the focused tests and confirm they fail for the missing ownership and token-reuse behavior.
- [ ] Add an explicit Runtime platform-tool transport capability and central snapshot builder options.
- [ ] Reuse an unexpired in-process tool context token only when its identity and visible-tool fingerprint are unchanged; revoke/replace it otherwise.
- [ ] Keep embedded mode and direct external MCP servers compatible while preventing process mode from spawning the platform stdio gateway.
- [ ] Run focused tool, snapshot, HTTP MCP, and Runtime fingerprint tests.
- [ ] Commit Stage 1 independently.

### Task 2: Make cancellation terminal in the Runtime child

**Files:**
- Modify: `src/ports/runtime-port.ts`
- Modify: `src/runtime/service/protocol.ts`
- Modify: `src/runtime/api/process-runtime-port.ts`
- Modify: `src/runtime/api/embedded-runtime-port.ts`
- Modify: `src/runtime/service/service.ts`
- Modify: `src/runtime/service/acp-runtime-host.ts`
- Modify: `src/runtime/service/sdk-runtime-host.ts`
- Modify: `src/runtime/service/sdk-runtime-prompt.ts`
- Create: `src/runtime/service/runtime-active-turns.ts`
- Modify: `src/runtime/service/acp-runtime-client.ts`
- Modify: `src/commands/session-command-service.ts`
- Modify: `src/core/sessions.ts`
- Test: `tests/unit/sdk-runtime-host-lifecycle.test.ts`
- Test: `tests/integration/session-command-service.test.ts`
- Test: `tests/integration/runtime-process.test.ts`

- [ ] Add failing host tests for `not-found`, `not-active`, soft terminal cancellation, close-session escalation, and Agent-restart escalation.
- [ ] Add a failing regression test proving cancellation publishes exactly one `cancelled` done with the original `messageId` and `turnId`.
- [ ] Add a failing command-service test proving API cancellation never clears local prompt state or emits a synthetic done.
- [ ] Run the focused tests and confirm the intended failures.
- [ ] Add structured `RuntimeCancelResult` and IPC result parsing.
- [ ] Track active turns by Session with generation, original identifiers, terminal completion, and cancel-request state.
- [ ] Fence router updates and terminal publication to the active generation so late output is ignored.
- [ ] Escalate cancellation in the Runtime child: ACP cancel, bounded wait, targeted ACP close, bounded wait, then Agent restart.
- [ ] Convert a cancelled prompt rejection into the single original terminal `cancelled` event; let unrelated Agent turns fail explicitly if a shared process restart is required.
- [ ] Remove the API timeout/fake-done path and require a structured terminal Runtime result.
- [ ] Run focused Runtime, command, crash-recovery, persistence, and realtime ordering tests.
- [ ] Commit Stage 2 independently.

### Task 3: Add immediate and deduplicated PC stopping UX

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/global-assistant.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/global-assistant/GlobalAssistantInput.tsx`
- Test: `tests/unit/global-assistant-store.test.ts`
- Test: relevant Session store tests under `tests/unit/`

- [ ] Add failing store tests proving the first click sets stopping immediately, repeated clicks reuse one command ID/request, and terminal events clear stopping.
- [ ] Add a failing test proving cancel failure is visible and restores a retryable running state.
- [ ] Run the focused tests and confirm the intended failures.
- [ ] Add per-Session stopping state and stable cancel command identity derived from the active turn/message.
- [ ] Keep the composer responsive and preserve the draft/images while cancellation completes; queue a replacement send behind the cancellation promise when needed.
- [ ] Render a concise Chinese stopping/failure state in Workspace and the global assistant and disable only duplicate Stop actions.
- [ ] Run focused UI store/component tests.
- [ ] Commit Stage 3 independently.

### Task 4: Verification and review

**Files:**
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/guides/testing.md`

- [ ] Update stable architecture documentation for process-owned HTTP MCP and Runtime-owned terminal cancellation.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Start only the isolated performance instance on port `19020` with its separate data directory and manually verify Claude stop/re-prompt behavior; do not touch port `18900`.
- [ ] Commit documentation/verification adjustments.
- [ ] Request independent `code-reviewer` review and address all P0/P1 findings.
- [ ] Do not merge into `prd` until review approval and an explicit merge decision.
