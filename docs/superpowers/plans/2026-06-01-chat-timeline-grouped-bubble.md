# Chat Timeline Grouped Bubble

**Goal:** Keep event timeline ordering while rendering one assistant turn as a single chat bubble with ordered inner blocks.

**Scope:** Only adjust timeline grouping/rendering for the Workspace chat view.

## Steps

- [x] Add tests for grouping assistant timeline items into one render group.
- [x] Implement a small grouping helper beside the timeline reducer.
- [x] Render timeline groups as one `ChatBubble` with ordered text/tool blocks.
- [x] Run targeted tests and project verification.

## Acceptance

- Assistant text, tool calls, and later text remain in chronological order.
- Consecutive assistant timeline items render under one avatar/name bubble.
- Human messages remain separate right-aligned chat bubbles.
