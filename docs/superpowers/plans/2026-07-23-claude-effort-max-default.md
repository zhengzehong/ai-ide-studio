# Claude Effort Max Default Implementation Plan

## Goal

Keep Claude ACP effort selections consistent across UI, Runtime state, and persisted session preferences. New sessions that expose a supported `max` effort option should start at Max, while explicit user choices remain authoritative.

## Scope

1. Update PC session and global assistant stores after a successful `session.setConfig` RPC.
2. Update the SDK Runtime session snapshot after a successful config change.
3. Apply `effort=max` when a newly opened Runtime session has no explicit effort preference and its capabilities advertise Max.
4. Preserve existing Codex model-id effort handling and explicit session overrides.
5. Add focused regression tests, then run the full test, lint, and build suites.

## Acceptance Criteria

- Selecting Max in a Claude session remains visibly selected after the RPC succeeds.
- Runtime capabilities and its in-memory preference snapshot agree after a config change.
- A first-time session advertising Max receives `setConfig('effort', 'max')`.
- A session with an explicit effort preference keeps that preference.
- Models without Max are unchanged.
- `npm test`, `npm run lint`, and `npm run build` pass.
