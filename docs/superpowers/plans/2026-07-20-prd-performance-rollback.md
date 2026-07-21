# PRD Performance Architecture Rollback Plan

> Date: 2026-07-20
> Preservation branch: `feat/single-port-edge-gateway`
> Pre-performance baseline: `7b84688`

## Goal

Keep the complete local performance architecture and single-port Edge work on an isolated branch/worktree, while restoring `prd` to the tracked repository state immediately before the performance architecture design and implementation began.

## Safety Rules

- Preserve all performance and Edge commits on `feat/single-port-edge-gateway` before changing `prd`.
- Merge that branch into `prd` first so the complete snapshot remains reachable from the main history.
- Restore tracked files with a new commit; do not rewrite `prd` history.
- Leave unrelated untracked files in the main workspace untouched.
- Verify both the preservation branch and the restored `prd` tree.

## Checklist

- [ ] Confirm `feat/single-port-edge-gateway` has a clean dedicated worktree and contains the complete architecture.
- [ ] Merge `feat/single-port-edge-gateway` into `prd` with a merge commit.
- [ ] Record the merged snapshot commit.
- [ ] Restore all tracked files on `prd` from `7b84688` and commit the rollback.
- [ ] Confirm `git diff --exit-code 7b84688 -- .` on restored `prd`.
- [ ] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check` on restored `prd`.
- [ ] Run a PRD startup smoke check and confirm port `18900` serves HTTP.
- [ ] Confirm the preservation branch/worktree still points to the complete performance and Edge implementation.

## Reintroduction

After the isolated architecture is validated, reintroduce it from `feat/single-port-edge-gateway` through a fresh review. Do not develop the performance architecture directly on the restored `prd` branch.
