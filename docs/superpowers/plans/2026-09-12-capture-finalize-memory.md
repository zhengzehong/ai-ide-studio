# Capture Finalization And Memory Limits

## Scope

Store one in-memory capture and write its existing JSON format once on completion, cancellation, upstream failure or timeout. Remove periodic and per-chunk full-record snapshots. Bound per-capture and aggregate retained capture payload; mark over-budget records as truncated while leaving model forwarding intact. Do not deploy/restart PRD or change production settings/data.

Task: task-4a98d07b; step: step-562400fa.

## Checklist

- [x] Inspect current capture writer, forwarding, recovery and tests; isolate worktree from prd.
- [x] Add failing regressions for no interim writes, one terminal write, late events and bounded retention.
- [x] Implement final-only persistence, shared capture budget, truncation and failure-safe release.
- [x] Verify timeout/cancel/error forwarding, old JSON recovery and isolated low-heap reproduction.
- [x] Update documentation and run tests/build/lint/typecheck; review final changes.
- [x] Prepare reviewed integration; commit and merge to prd as the final delivery operation, with the outcome recorded in the platform task. Do not deploy or restart services.

## Decisions

- Keep request/response JSON schema and paths; add optional truncated/truncationReason metadata.
- Default retained payload accounting: 16 MiB per capture, 128 MiB across active and finalizing captures. Account for string storage and per-chunk overhead; these are conservative capture accounting limits, not a limit on total Node process RSS.
- Reject oversized request retention with request=null and a truncation marker. Stop collecting new response chunks after the first budget refusal, retaining a contiguous prefix.
- Hold budget through terminal persistence, release on both success and failure, and clear retained request/response references. Finalization must be idempotent.
- Preserve existing interrupted .json.tmp recovery. A crash before finalization can lose the in-memory capture, an accepted tradeoff of the selected simple design.

## Validation

- Targeted regressions: 4 files / 49 tests passed, including complete SSE/JSON forwarding beyond capture limits.
- Low-heap reproduction: same 512 KiB request, 400 response chunks (440,800 bytes), 96 MiB old-space limit. Old writer exited 134 with a V8 heap exhaustion error after the 201-chunk sample; fixed writer exited 0 with 9,920,560 bytes heap at completion. Saved JSON contains all 400 chunks, 409,600 response text characters and the complete request, without truncation.
- Full suite: 465 files / 2,580 tests passed. Build, lint, root/server typechecks and diff whitespace checks passed in the isolated worktree.
- Final code review: no blocking findings. Confirmed the model forwarding implementation is unchanged; collection stops permanently on the first budget refusal, duplicate terminal events cannot overwrite a record, and reservations remain held until persistence settles. Existing JSON readers and temporary-file recovery remain compatible. Existing frontend large-chunk build warnings are unrelated to this backend change.
- Existing unrelated main-checkout changes are preserved. No production builds, service restarts or database/settings writes.
