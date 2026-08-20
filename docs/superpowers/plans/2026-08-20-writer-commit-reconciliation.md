# Writer Commit Reconciliation Implementation Plan

## Goal

Prevent a delayed or timed-out Writer Worker response from turning a successfully completed Agent turn into a failed turn or overwriting its final answer.

## Scope

- Reconcile `writer.commit` deadline failures by retrying the same idempotent batch ID.
- Return complete mutation results for duplicate batches so callers can consume retried event writes.
- Keep background persistence failures from poisoning terminal persistence after reconciliation.
- Make Agent message finalization a `running`-only state transition.
- Do not emit a second error terminal when the Agent message already reached a terminal state.

## Steps

1. Add regression tests for duplicate batch result reconstruction, deadline reconciliation, stale background persistence errors, and repeated terminal events.
2. Extend Writer duplicate handling to reconstruct mutation results and retry deadline failures with the original batch.
3. Adjust Session batching and terminal handling so a prior background error is logged without reclassifying a completed Agent turn.
4. Add a status guard to Agent message completion and preserve an existing terminal message.
5. Run targeted tests, the full test suite, lint, build, TypeScript checks, and `git diff --check`.
6. Commit the isolated branch and merge it into `prd` with `--no-ff` without restarting PRD services.

## Acceptance Criteria

- A Writer response that arrives after the client timeout is reconciled by the same batch ID and does not fail the turn.
- Retried event batches return the original persisted event result.
- A background persistence error does not overwrite or fail a later completed Agent message.
- A completed Agent message cannot transition to failed through a duplicate terminal event.
- Existing permanent Writer errors remain observable and are not silently reported as successful commits.
- `npm test`, `npm run lint`, and `npm run build` pass.

## Risks

- Retrying with a new batch ID would duplicate mutations; retries must preserve the original batch ID.
- Duplicate batches must reconstruct results expected by `appendEvent`, not return an empty result list.
- Ignoring every persistence error would hide real data loss; only terminal classification is decoupled, while failures remain logged and critical terminal persistence is still attempted.
