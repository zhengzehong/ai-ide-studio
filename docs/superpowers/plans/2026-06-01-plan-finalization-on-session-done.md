# Plan Finalization On Session Done

**Goal:** Prevent the workspace plan bar from keeping an item spinning after a normal assistant turn has already ended.

**Scope:** Only adjust session plan state derivation and realtime session done handling in `D:\code_space\python_space\ai-ide-studio`.

## Steps

- [x] Add tests for plan finalization after `message.done`.
- [x] Implement a small shared helper to finalize in-progress plan entries on normal turn completion.
- [x] Use the helper in historical event reduction and realtime `session:done` handling.
- [x] Run focused tests, then project verification.

## Acceptance

- A latest `plan.update` with an `in_progress` entry followed by `message.done` with `stopReason: "end_turn"` renders that entry as `completed`.
- `message.done` with `stopReason: "error"` or `"cancelled"` does not mark in-progress plan entries completed.
- Existing session event reducer behavior remains intact.
