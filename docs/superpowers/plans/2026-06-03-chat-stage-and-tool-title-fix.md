# Chat Stage And Tool Title Fix Plan

**Goal:** Fix two chat regressions without changing the broader conversation model.

## Success criteria

- During streaming, lifecycle status such as `正在准备 Agent...` / `正在思考...` can still be shown as immediate feedback.
- After a turn completes, lifecycle-only stage blocks are not persisted as an execution process.
- Completed turns only show `<执行过程>` when they contain real thinking, tools, or intermediate note blocks.
- MCP-style tool calls with `rawInput.server/tool/arguments` render human-readable names instead of generic `工具调用 #xxxxxx`.
- Changes are covered by targeted tests and pass validation.

## Tasks

- [x] Add regression tests for lifecycle-only completed turns.
- [x] Add regression tests for MCP-style tool-call summaries/titles.
- [x] Filter lifecycle `stage` blocks out of completed-turn process persistence.
- [x] Improve backend and frontend tool-call title derivation from MCP raw input.
- [x] Run targeted tests, full tests, build, lint, and diff check.
- [x] Commit the current-branch fix and merge it into `prd`.
