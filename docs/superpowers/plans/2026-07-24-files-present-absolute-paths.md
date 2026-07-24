# Files Present Absolute Paths Plan

## Goal

Allow authenticated `files.present` and `fs.read` flows to read any absolute
file path accessible to the AI IDE server account, while keeping relative paths
anchored to the current project workspace.

## Constraints

- Keep access-token and MCP bearer-token authentication unchanged.
- Reject missing paths, directories, and unreadable files.
- Relative paths must not escape the workspace; callers can use an explicit
  absolute path when they intend to read outside it.
- Do not restart the running PRD service during implementation.
- Do not add a database migration.

## Steps

1. Add filesystem regression tests for absolute reads/presentation metadata and
   retained relative traversal protection.
2. Resolve absolute file paths directly in the read/inspect boundary while
   preserving workspace-relative behavior for relative inputs.
3. Resolve HTTP MCP `workDir` from the trusted token project and pass the same
   project workspace to the stdio Tool Gateway.
4. Add an HTTP MCP end-to-end test for `files.present` with relative and
   absolute paths.
5. Update the tool contract and architecture documentation.
6. Run targeted tests, full tests, lint, build, bundle, and diff checks.
7. Commit and merge into `prd` without restarting services.

## Acceptance

- A workspace-relative file can be presented and opened.
- A readable absolute file inside or outside the workspace can be presented
  and opened.
- Relative `..` traversal remains rejected.
- HTTP and stdio MCP contexts use the real project workspace.
- Existing authentication remains required by the hosting transport.
