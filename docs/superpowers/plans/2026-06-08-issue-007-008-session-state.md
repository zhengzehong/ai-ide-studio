# ISSUE-007/008 session state fix

## Goal

Fix two chat/session consistency bugs without changing unrelated ACP behavior:

1. ISSUE-007: when loading a running session, a visible streaming turn from another session must not stay on screen.
2. ISSUE-008: a delayed cancel timeout for an old turn must not mark a newer turn in the same session as cancelled.

## Plan

1. Add a frontend regression test for restoring the current session's running message over a stale visible streaming turn.
   - Verify: the test fails before the store logic is changed.
2. Add a backend regression test for cancel timeout turn identity.
   - Verify: the old timeout path does not clear a different active turn.
3. Apply minimal fixes:
   - Frontend: choose the persisted running message when its id differs from the current streaming turn.
   - Backend: track active turn identity on runtime session state and scope cancel timeout cleanup to that identity.
4. Verify with targeted tests, then full test/lint/build checks.
5. Commit on current branch, cherry-pick to `prd`, verify there, and update the issue table with both commit ids.

## Acceptance

- Switching away and back to a running session shows the same running message state for that session.
- A cancel timeout only forces done for the turn that was active when cancel was requested.
- Existing same-message streaming refresh behavior stays intact.
