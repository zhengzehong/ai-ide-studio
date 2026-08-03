# Widget Compact 300px Layout

## Goal

Restore the desktop Widget to 300px wide while keeping each Session on one line,
reducing unused left space, and retaining a compact right-aligned activity time.

## Steps

1. Update layout tests for a 300x400 Widget and position migration.
2. Add focused row tests for compact time labels and removal of the repeated task icon.
3. Reduce Session indentation and state-column width, preserve one-line ellipsis,
   and keep the time visible at 300px.
4. Verify the 300x400 layout with Playwright screenshots and overlap checks.
5. Run targeted tests, full tests, lint, TypeScript, and build.
6. Complete independent review, merge to prd, and run `npm run package:desktop`.

## Acceptance Criteria

- Widget width is 300px and height remains 400px.
- Session rows stay on one line with status first and compact time on the right.
- Session content begins near the Agent identity instead of after an 83px gutter.
- Installer, portable, and win-unpacked packages are regenerated without removing APKs.
