# PRD Performance Architecture Rollback Plan

## Goal

Keep the complete local performance architecture and single-port Edge implementation on
`feat/single-port-edge-gateway`, while restoring `prd` to the last commit before the
performance architecture work started.

## Anchors

- Pre-performance baseline: `7b84688` (`merge: add project session activity stats`)
- Performance design starts: `c203bd7`
- Performance implementation merge: `8848fdd`
- Runtime timeout follow-up: `2285bb7`
- Preserved implementation branch: `feat/single-port-edge-gateway`
- Preserved worktree: `C:/Users/Administrator/.config/superpowers/worktrees/ai-ide-studio/single-port-edge-gateway`

## Checklist

- [x] Confirm the main `prd` worktree has no tracked local changes.
- [x] Confirm the preservation branch and worktree exist and contain the complete implementation.
- [x] Commit this rollback record on the preservation branch.
- [x] Merge the preservation branch into `prd` to create an auditable complete snapshot.
- [x] Verify the preservation branch still points to the complete implementation after the merge.
- [x] Restore all tracked files on `prd` to the `7b84688` tree without rewriting history.
- [x] Commit the rollback on `prd`.
- [x] Verify the resulting `prd` tree matches `7b84688` for tracked files.
- [x] Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check` on rolled-back `prd`.
- [x] Smoke-start the rolled-back PRD service and verify the configured public port.

## Recovery

The rollback is a normal commit, not a reset. The full architecture remains reachable from
`feat/single-port-edge-gateway` and from the merge commit immediately before the rollback.
After validation, it can be reviewed and merged again without reconstructing any code.
