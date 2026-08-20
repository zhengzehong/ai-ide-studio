# Task Dispatch Semantics Fix

## Goal

Keep `createSimple(selfExecute=true)` free of duplicate initial prompts while ensuring every newly unlocked task step receives a real prompt, uses the intended Session, and reports truthful dispatch state.

## Scope

- Remove the Agent-identity-based downstream prompt skip.
- Resolve an unbound step from the task's linked Session only when that Session belongs to the step assignee, then fall back to the assignee primary Session or a new Session.
- Expose per-step Session IDs in task summaries and clarify task-level versus step-level assignment semantics.
- Add regression coverage for same-Agent continuation, task Session inheritance, and explicit step Session routing.

## Acceptance

- Initial `selfExecute=true` step still does not receive a duplicate prompt.
- A dependent ready step for the same Agent queues a prompt and can execute after the current turn.
- A dependent step inherits a task-linked Session only when Agent ownership matches.
- Explicit `step.sessionId` always wins and cross-Agent Session reuse is rejected.
- Existing delegated and multi-Agent dispatch behavior remains unchanged.

## Verification

- Targeted task/step tests.
- `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- No PRD service or database restart.
