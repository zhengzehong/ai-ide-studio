# Runtime Persistence Flush Serialization Plan

**Goal:** Stop the shared Runtime process from exiting when multiple persistence flush batches overlap a slow Writer.

## Checklist

- [x] Add a failing regression with one blocked persistence write and at least two later UI/persistence batches.
- [x] Confirm the failure reproduces a missing or reused UI cursor.
- [x] Serialize the complete persistence flush lifecycle while keeping UI delivery independent.
- [x] Preserve fail-loud cursor invariants and log timer flush failures before process exit.
- [x] Run targeted tests, full tests, lint, type checking, build, and diff check.
- [ ] Review and merge the isolated fix into `prd` without restarting the running service.

## Acceptance

- Every frozen persistence batch reuses the UI cursor assigned for its visible patch.
- A slow Writer cannot make later batches consume, overwrite, or delete each other's cursors.
- Runtime failures include the original flush error in structured logs.
- Existing PRD processes remain untouched during implementation and validation.
