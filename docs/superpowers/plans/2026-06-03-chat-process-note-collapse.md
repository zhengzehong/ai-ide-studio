# Chat Process Note Collapse Plan

**Goal:** Keep execution process useful by emphasizing tools and collapsing intermediate assistant notes.

## Success criteria

- Intermediate assistant replies inside `<执行过程>` render as a compact `中间说明` row by default.
- Users can expand a note to inspect the full intermediate text.
- Tool calls, thinking blocks, and final answers keep current behavior.
- This is presentation-only; no message/event persistence logic changes.
- Build/lint/diff checks pass.

## Tasks

- [x] Inspect current `ProcessBlockView` note rendering.
- [x] Add compact collapsible `note` rendering.
- [x] Keep non-note process blocks unchanged.
- [x] Run build/lint/diff checks.
- [x] Commit and merge to `prd`.
