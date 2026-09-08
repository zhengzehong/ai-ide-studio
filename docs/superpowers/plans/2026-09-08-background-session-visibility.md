# Background Session Visibility

## Scope
Hide advisor, inspiration, secretary and autonomy runtime sessions from ordinary PC/mobile lists, activity summaries, Widget and Dock. Preserve dedicated history, execution and task flows. No PRD restart or online data edits.

## Checklist
- [x] Add failing coverage for legacy configuration-linked sessions and new runtime purposes.
- [x] Add shared purpose policy and store SQL predicate; keep internal session access separate from user lists.
- [x] Mark new advisor/inspiration sessions with dedicated purposes; retain previous legacy identity when rebuilding.
- [x] Apply policy to query projections, frontend list/summary and live update admission.
- [x] Verify dedicated features, task sessions, worker/local parity and frontend regression tests.
- [x] Run full tests with limited workers, lint, types, build and diff check in isolated worktree.
- [x] Review diff and address reorder-response leakage and internal bulk-action compatibility.

## Verification
Two full runs: 424 files / 2270 tests passed, maxWorkers=2. Lint, build, typecheck and repository-configured diff check passed. Build retains existing chunk-size warnings.

Commit and PRD merge outcome is recorded in task-bf408f5a / step-70ba9423; no service restart.

## Compatibility
Existing configuration references identify legacy conversation sessions without bulk data migration. Do not infer background identity from editable titles. Previously detached legacy sessions without reliable provenance remain an explicit limitation.

## Acceptance
Normal user/task sessions retain running/unread status. Background sessions remain readable by ID in dedicated features but do not contribute to user activity, badges or pin candidates. Shared Agent identities must not hide normal sessions owned by the same Agent.
