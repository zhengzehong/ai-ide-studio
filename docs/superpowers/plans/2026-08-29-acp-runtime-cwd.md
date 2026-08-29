# Explicit ACP Runtime Working Directory

## Goal

Ensure Claude/Codex ACP child processes do not inherit the API process working directory. The runtime process must start with the Session snapshot working directory so native Session files are stored under the same project context used by the platform.

## Scope

1. Add a regression test asserting the managed ACP spawn receives an explicit `cwd`.
2. Pass `snapshot.session.cwd` through the SDK runtime start boundary.
3. Set `cwd` on the actual child process spawn.
4. Verify targeted and full tests, lint, TypeScript, build, and diff checks.

## Compatibility

- No database migration or frontend changes.
- Existing historical sessions whose Claude files are already in a different project directory are out of scope for this root fix.
- Runtime Agent remains shared; the existing Agent/runtime fingerprint and project-scoped Agent model are unchanged.
