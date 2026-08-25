# Turn Finalization And Runtime Rebind Fix

## Goal

Prevent successful ACP turns from appearing to end silently when terminal updates arrive after final text or when an active Session is rebound while the turn is running.

## Scope

- Treat only a new tool invocation as a process boundary.
- Preserve active turn identifiers when the same ACP Session is rebound.
- Defer Session context replacement while a prompt is active.
- Drop and diagnose turn-scoped ACP updates that have no active turn binding instead of assigning random message IDs.
- Keep database schema, WebSocket protocol, PC UI, and mobile UI unchanged.

## Implementation

1. Add regression coverage for final text followed by an existing tool update and for an update that introduces a previously unseen tool.
2. Track tool IDs in the persisted turn process so existing tool updates do not demote final text.
3. Update the in-memory finalizer to use the same new-tool boundary rule.
4. Make Runtime Session rebinding preserve `messageId`, `turnId`, and `streamGeneration` for the same ACP Session.
5. Defer changed Session context/profile application until the active prompt has completed.
6. Reject orphaned turn-scoped updates with structured diagnostics rather than random IDs.

## Verification

- Targeted unit/integration tests for turn finalization, process items, ACP Runtime client, and SDK Runtime lifecycle.
- `npm test`
- `npm run build`
- `npm run lint`
- `git diff --check`

## Acceptance Criteria

- `final text -> existing tool update -> end_turn` preserves final text.
- `text -> new tool call -> final text` still demotes the earlier text.
- Rebinding the same ACP Session during a turn retains the original message and turn IDs.
- Context changes during an active prompt do not close or resume the Session until a later ensure.
- Turn updates without a binding are not persisted under per-event random message IDs.
