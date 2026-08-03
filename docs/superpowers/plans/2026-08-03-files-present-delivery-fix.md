# Files Present Delivery Fix

## Goal

Make `files.present` delivery deterministic for Claude Code and Codex across realtime rendering, message persistence, history recovery, PC, and mobile.

## Checklist

- [x] Capture production event shapes for Claude Code and Codex.
- [x] Add failing regressions for the Codex final gateway update and process-item identity.
- [x] Canonicalize presentation tools in the presentation adapter only.
- [x] Support direct and gateway-wrapped MCP outputs.
- [x] Deduplicate realtime and process-item tool blocks by the original tool-call ID.
- [x] Repair recoverable historical presentations.
- [x] Run focused, full, lint, typecheck, build, and diff checks.
- [x] Merge the reviewed fix into `prd` without restarting services.
