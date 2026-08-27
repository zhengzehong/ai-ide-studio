# Session Diff Performance Fix Implementation Plan

## Goal

Remove full historical file diffs from the initial message response and prevent file-diff generation from blocking the API event loop, while preserving on-demand diff details and terminal message consistency.

## Implementation Checklist

- [x] Add regression tests proving legacy `file_changes_json` is projected to a lightweight summary.
- [x] Add regression tests proving Runtime UI updates omit `oldText`, `newText`, and line-level diff content while persistence keeps the source update.
- [x] Add a dedicated file-change worker and a coalescing processor keyed by Session, message, and tool call.
- [x] Change turn-process persistence to enqueue worker computation and drain it before terminal finalization.
- [x] Remove terminal recomputation from all accumulated tool calls and reuse Writer aggregation from committed process items.
- [x] Add worker failure, coalescing, terminal drain, reset fencing, and event-loop responsiveness tests.
- [x] Update architecture documentation and README performance behavior.
- [x] Run targeted tests, full tests, TypeScript checks, lint, build, and `git diff --check`.
- [x] Review the final diff and prepare the verified feature commit for a non-restarting `prd` merge.

## Compatibility Rules

- Keep the existing `file_changes_json` field and JSON summary shape.
- Do not migrate or rewrite the online database.
- Keep complete diff details available through `sessions.messageFileChanges`.
- A diff worker failure must not fail or interrupt the Agent turn.
- Session completion must wait for accepted diff work so summaries cannot disappear at the terminal boundary.

## Acceptance Criteria

- Legacy message rows containing `segments`, `oldText`, `newText`, or `lines` return only file-level summaries.
- Runtime UI updates never expose complete diff text; persistence updates retain enough data to generate details.
- File-change LCS work executes outside the API event loop and repeated updates are coalesced.
- Terminal finalization does not call `buildFileChangesFromToolCalls()` over the full turn.
- Existing PC and mobile message contracts remain compatible.

## Verification Results

- Full suite: 365 files, 1,843 tests passed.
- TypeScript: root and server configurations passed with no errors.
- Lint and production build: passed for server, PC, and mobile.
- Largest PRD message sample (read-only): 2,251,330-byte legacy diff projected to 4,613 bytes in 4.5ms.
- 10,000-line worker sample: caller returned in 0.27ms; worker completed in 4.26ms with `+1 / -1`.
