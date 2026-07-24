# Claude Auto Compact Window Plan

## Goal

Make each Claude model profile's `context_window` the explicit ACP Session
`autoCompactWindow`, so Claude Code treats the threshold source as configured
and runs automatic compaction for custom model names.

## Constraints

- Keep `autoCompactWindow` equal to `context_window`; do not lower the value.
- Do not configure an output-token budget.
- Do not add a database field or migration.
- Do not restart the running PRD service during implementation.

## Steps

1. Add regression tests proving a 200000 profile produces both
   `CLAUDE_CODE_MAX_CONTEXT_TOKENS=200000` and
   `settings.autoCompactWindow=200000`.
2. Extend Claude Session metadata types and construction with the explicit
   auto-compact window.
3. Verify the applied value participates in the existing Session metadata
   fingerprint so a changed profile window rebinds the ACP Session.
4. Run targeted tests, the full suite, lint, build, bundle, and diff checks.
5. Commit the branch and merge it into `prd` without restarting services.

## Acceptance

- Positive Claude profile context windows are passed unchanged as
  `settings.autoCompactWindow`.
- Profiles without a context window do not create the setting.
- The existing max-context environment injection remains unchanged.
- All repository validation commands pass.
