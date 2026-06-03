# Tool Call Display Direct Name Fix Plan

**Goal:** Fix the chat tool-call display without changing runtime/tool data semantics.

## Success criteria

- MCP-style tool calls display the direct tool name, e.g. `filesystem.read_text_file C:\...\file.md`.
- The UI does not translate MCP tool names into labels like `读取 ...`.
- The tool-call header has only one expand/collapse chevron; the duplicated terminal/wrench-style icon is removed.
- Existing Team-specific summaries remain unchanged.
- Targeted tests and build/lint checks pass.

## Tasks

- [x] Update MCP tool summary tests to expect direct `server.tool` text.
- [x] Update `toolSummary` for MCP raw input direct display.
- [x] Remove the extra tool-kind icon from `ToolCallPanel` header.
- [x] Run targeted tests and validation.
- [x] Commit and merge to `prd`.
