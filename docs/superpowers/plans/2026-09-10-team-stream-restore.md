# Team stream restoration

Scope: team conversation restoration only. Use existing message/event APIs; do not restart PRD or start an application server.

- [x] Add regression cases for empty recovery, concurrent chunks/done, long turns, and session isolation.
- [x] Separate team snapshot helpers from the component; restore the active turn with messageEvents and reconcile sequenced live events.
- [x] Invalidate obsolete loads and subscribe to members before fetching their history.
- [x] Run targeted tests, full npm test, build, lint and TypeScript checks in this worktree.
- [x] Review final diff and prepare the scoped commit for merge into prd, preserving unrelated edits and production assets.

Acceptance: returning during a turn restores prior text/thinking/tools; completion never becomes an empty running bubble; concurrent events are neither lost nor duplicated; obsolete conversation loads cannot overwrite the selected conversation.

Validation: 442 test files / 2442 tests passed; team-focused suite 38 tests passed. Production build, lint, frontend TypeScript check and diff whitespace check passed. Build retains the pre-existing large-chunk advisory. No browser smoke test against the running PRD service was performed.

Review: checked cold/active/completed restoration, loaded prefix versus concurrent tail, late duplicate done, cancelled/failed turns, session isolation, assignment metadata, supplemental process items, subscription cleanup and request invalidation. No backend, schema or model execution changes. Existing snapshot helpers were extracted to keep the component under 300 lines.

Environment notes: the first full test attempt inherited PRD LOG_DIR and was stopped after test output revealed it. Subsequent runs explicitly used worktree-local DATA_DIR and LOG_DIR. An isolated-worktree missing local ACP binary link caused one infrastructure test failure; dependency links were corrected and the full suite then passed. PRD was not restarted and its frontend build artifacts were not replaced.
