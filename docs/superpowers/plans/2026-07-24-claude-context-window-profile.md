# Claude Model Profile Context Window Plan

## Goal

Make a Claude model profile's `context_window` authoritative across the runtime
environment, ACP session metadata, runtime restart fingerprint, structured logs,
and PC usage reporting.

## Constraints

- Do not configure `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
- Do not restart the running PRD service during implementation.
- Preserve profiles with a null context window as an unset override.
- Keep credentials out of logs and tests.

## Steps

1. Add regression tests for model-profile environment construction, session
   metadata, runtime fingerprint changes, and context-window reporting.
2. Inject `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from positive Claude profile values
   and include it in the session settings environment.
3. Include the applied value in runtime environment fingerprints and structured
   environment summaries.
4. Carry the applied model-profile context window through the runtime snapshot
   so ACP usage updates can report the configured size instead of the adapter's
   heuristic default.
5. Run targeted tests, the full test suite, lint, build, and diff checks.
6. Commit the branch and merge it into `prd` without restarting services.

## Acceptance

- A Claude profile with `context_window=200000` starts with
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS=200000`.
- ACP session settings contain the same value.
- Changing the value changes the Agent runtime fingerprint.
- PC usage events report the applied profile value.
- Null/invalid values do not inject an override.
- `npm test`, `npm run lint`, and `npm run build` pass.
