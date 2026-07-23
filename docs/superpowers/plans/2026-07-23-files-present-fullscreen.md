# Files Present Fullscreen Plan

## Goal

Make the PC multi-file presentation viewer open as a full-viewport workspace by default and make the copy action visibly confirm success.

## Scope

- Update `PresentedFilesModal` to use the full viewport without a centered dialog margin.
- Keep the file list, lazy `fs.read`, Markdown rendering, Escape/close behavior, and multi-file switching unchanged.
- Add explicit copied feedback so the copy icon is not mistaken for an inactive fullscreen control.
- Do not change the mobile viewer, database, runtime, or service startup.

## Checklist

- [x] Add a failing PC rendering test for the full-viewport shell and explicit copy action.
- [x] Implement the full-viewport layout and copy feedback.
- [x] Run targeted tests, UI build, full tests, lint, TypeScript, and diff check.
- [ ] Request independent review and merge to `prd` only after approval.

## Acceptance

- The viewer opens at viewport width and height by default.
- Multiple files remain switchable.
- Copy action reports success and is clearly labeled.
- No PRD restart or online database operation occurs.
