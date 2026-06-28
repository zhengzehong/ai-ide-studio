# Chat Process Collapse And Stats Fix Plan

**Goal:** Improve completed chat turn presentation without changing ACP/session persistence semantics.

## Success criteria

- While a turn is streaming, `<执行过程>` can stay open for live feedback.
- After a turn completes, `<执行过程>` is collapsed by default.
- Completed agent bubbles show the turn stats footer again when stats are available: elapsed time, input tokens, output tokens, total tokens/cost.
- Historical messages with `decision_json` continue to show stats.
- Build/lint/diff checks pass.

## Tasks

- [x] Locate `processDefaultOpen` and turn stats rendering.
- [x] Change completed-turn default process state to collapsed.
- [x] Restore stats footer for turn-model bubbles.
- [x] Run targeted/full validation.
- [ ] Commit and merge to `prd`.
