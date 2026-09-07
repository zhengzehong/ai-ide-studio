# Advisor Quality and Batched Wakeup

Approved scope: project-neutral recommendations (including writing/research),
backend-owned defaults, exact legacy-default migration, 15-minute project batches,
work coverage and settled feedback. Keep dedicated sessions and existing suggestion UI.
No PRD restart, online DB edits or independent services during development.

- [x] Add regression tests for configuration, batching and context.
- [x] Implement shared defaults and legacy migration; preserve custom prompts.
- [x] Extract batch scheduler, update lifecycle and round ownership.
- [x] Include bounded work coverage, feedback and multi-session evidence.
- [x] Update settings, tool schema and documentation.
- [x] Run tests, build, lint and review changes.

Verification: 411 test files / 2211 tests passed; build and lint passed.
An isolated Playwright page verified backend default display, custom edit, reset,
and toggle persistence without starting a service.
Review additionally fixed latest-message clipping and rebuilt advisor self-triggering.
Known defaults were matched against all six PRD configurations using read-only hashes;
the migration itself was tested only on temporary databases. Production migration and
new behavior require the normal release startup. Model recommendation quality still
needs observation after release; no live evaluation cards were injected.
Commit/merge outcome is recorded in the platform task report after this source commit.

Validation: no automatic prompt before 15 minutes; one batch across sessions;
no backlog while busy; disabled/rebuilt sessions reject stale results; empty reports
are valid; known defaults migrate while customized text stays; reset persists empty.
