# Files Presentation Delivery Fix

## Goal

Keep `files.present` and `preview.publish` cards reliable when an ACP adapter
reports only a tool start and omits the terminal MCP tool result. Preserve the
existing PC/mobile presentation UI and avoid duplicate tool rows.

## Constraints

- Do not change the PC or mobile card components.
- Do not add a database migration.
- Do not depend on an ACP adapter echoing a platform-owned HTTP MCP result.
- Keep ordinary tools on the existing ACP lifecycle.
- Merge to `prd` without restarting the running PRD service.

## Steps

1. Add failing tests for Codex dotted MCP titles and Runtime update-key
   collisions between tool, usage, and configuration events.
2. Add an in-memory registry for successful platform presentation results.
   Match the result to the subsequent ACP tool call using session, canonical
   tool name, and normalized input. Drain unmatched results before
   `session:done` as a fallback.
3. Wire HTTP MCP tool execution to record only successful
   `files.present`/`preview.publish` results. Reconciled results must reuse the
   ACP toolCallId, publish `completed/rawOutput`, and reach both realtime and
   final message persistence.
4. Export one shared Runtime update-key function and isolate tool call,
   tool update, usage, configuration, command, session-info, plan, and
   lifecycle updates.
5. Add integration coverage proving that a platform result plus an
   in-progress Codex tool call produces a realtime completed update and a
   durable `presentations_json` manifest.
6. Run targeted tests, TypeScript, full tests, lint, build, bundle gate, and
   `git diff --check`; commit and merge into `prd`.

## Acceptance

- Codex `mcp.ai-ide-tools.files.present` produces the same card as Claude.
- A missing ACP terminal result cannot drop a successful platform card.
- Tool and system updates in the same batching window remain separate.
- No duplicate presentation or process item is created.
- Existing frontend behavior and database schema remain unchanged.
