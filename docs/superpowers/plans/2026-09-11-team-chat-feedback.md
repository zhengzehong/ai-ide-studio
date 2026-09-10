# Team Chat Feedback Parity

## Scope

Match team chat with ordinary chat for immediate pending feedback and per-turn statistics. Keep statistics below the reply bubble in both views. Preserve independent member turns, queued prompts, event replay and completed history. Do not restart PRD or build into its served directories.

## Checklist

- [x] Reproduce missing pending feedback and timing with focused tests.
- [x] Add pending prompt reconciliation and failure cleanup to team chat.
- [x] Reuse one statistics footer below both reply bubbles, including live elapsed time.
- [x] Verify first events, concurrent members, queued sends, failure/cancel, history restoration and statistics.
- [x] Run npm test, npm run lint, npm run build and git diff --check in this worktree.
- [x] Review final diff and record delivery.

## Acceptance

Sending to an idle Master immediately shows preparation feedback. Real events replace that feedback without duplication. Lifecycle-only turns retain an execution panel. Running turns show elapsed time; completed turns retain their own usage and elapsed values. The footer position and style match ordinary chat. A rejected queued send does not clear a running turn. No backend, runtime or database changes are required.

## Verification And Review

- Shared footer renders outside the bubble, left-aligned with a 6px top gap. Both personal Workspace and ConversationMessageList use it. Missing usage fields are not fabricated as zero.
- Team pending tests cover first-event replacement, hidden lifecycle updates, queued rejection, per-member clocks, failure/cancel before output, history reconciliation and server/client clock differences.
- Offline Playwright verification passes at 1200px and 480px: pending panel/spinner, elapsed timer, remount, concurrent streams, completed statistics, footer geometry, rejection and cancellation. No application server was started.
- Full suite: 448 files, 2490 tests; 2489 passed and one model-proxy-runtime test failed only during Windows temporary-directory cleanup (EPERM). The failure moved between Claude/Codex cases on full-suite rerun. Isolated rerun of that unchanged integration file passed both tests. No model-proxy source or tests were modified.
- npm run build and npm run lint passed. Build retains the existing bundle-size warning. git diff --check passed.
- Final review checked pending ID replacement, completed-turn guards, sequence replay, independent members, timer cleanup, shared-pane consumers and partial historical usage. No blocking issue found in this change. The unrelated integration cleanup remains an intermittent validation limitation.
- PRD service and served build directories were not restarted or modified; validation artifacts remain local to this worktree.
