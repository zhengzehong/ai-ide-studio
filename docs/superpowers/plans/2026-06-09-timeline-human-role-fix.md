# Timeline Human Role Fix

## Goal

Fix timeline generation for existing chat sessions where user messages are stored as `human`.

## Steps

1. Add a regression test for historical timeline generation from `human` messages.
   - Verify: the test fails before the fix with zero timeline rows.
2. Update timeline role checks to treat `human` and legacy `user` as user messages.
   - Verify: historical generation and turn collection find the same turns as chat storage.
3. Run targeted tests, then project checks.
   - Verify: timeline regression passes, build and lint have no new failures.
4. Commit current branch and cherry-pick the fix into `prd`.
   - Verify: both worktrees contain the fix commit.
