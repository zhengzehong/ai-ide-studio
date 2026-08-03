# Agent Session Runtime Configuration Plan

## Goal

Expose the existing ACP session capability and configuration controls to platform Agents without adding a new evaluation product surface.

The final Agent workflow is fixed as:

```text
core.session.create
-> core.session.capabilities
-> core.session.configure
-> verify applied state
-> watch
-> task/message send
```

## Scope

1. Extract the Gateway-private ACP Session ensure/configuration flow into a shared core service.
2. Keep `core.session.create` unchanged as a local Session creation tool.
3. Add `core.session.capabilities({ sessionId })`:
   - validate project access and active Session state;
   - create or resume the real ACP Session without sending a prompt;
   - return the actual models, modes, config options, and current values.
4. Add `core.session.configure({ sessionId, modelId?, modeId?, config? })`:
   - require an empty, idle Session;
   - ensure the real ACP Session idempotently;
   - validate every requested value against current capabilities;
   - await Runtime acknowledgement before persisting preferences;
   - return requested and applied state, failing on mismatch.
5. Reuse the same shared service from PC Session RPC handlers.
6. Register and document the new built-in tools.

## Safety Rules

- Never persist a requested model, mode, or config value before the Runtime call succeeds.
- Never allow the Agent tool to configure a Session containing messages or an active/queued prompt.
- Never configure a Session outside the caller's project scope.
- Never silently accept an unavailable model, mode, or config value.
- The tool response must contain the applied capability state.
- A prompt is not sent by either new tool.

## Tests

1. Capabilities ensures a real ACP Session and sends no prompt.
2. Configure persists only after successful Runtime acknowledgement.
3. Runtime failure leaves preferences unchanged.
4. Invalid model/mode/config values are rejected before mutation.
5. Cross-project, non-active, non-empty, active, and queued Sessions are rejected.
6. Two Sessions belonging to the same Agent retain independent model selections.
7. Runtime restart restores the confirmed Session preferences.
8. Existing PC RPC model/mode/config behavior remains compatible.

## Validation

- Targeted unit and integration tests.
- `npm test`.
- `npm run lint`.
- `npm run build`.
- `git diff --check`.
- Independent code review before merging to `prd`.

## Out Of Scope

- New UI or evaluation pages.
- New database tables or migrations.
- New Runtime IPC operations.
- ACP SDK changes.
- Parallel repository worktree orchestration.
