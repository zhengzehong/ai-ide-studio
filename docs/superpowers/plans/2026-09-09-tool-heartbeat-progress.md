# Tool Heartbeat Progress

## Scope

Normalize confirmed Claude tool heartbeat updates into the existing tool within
the active turn. Never create heartbeat tools or revive completed/failed tools.
Hide confirmed legacy placeholders when their parent tool is present. Do not
change command execution, database records, PRD services, or model configuration.

## Checklist

- [x] Reproduce runtime phantom tools and legacy history rendering in tests (7 failures).
- [x] Add one shared ACP heartbeat normalizer to both runtime entry points.
- [x] Add conservative legacy history filtering for events and process items.
- [x] Validate isolation, late updates, regular tools, and incomplete history.
- [x] Run npm test, npm run build, npm run lint and diff checks.
- [x] Review changes and add regression coverage for ambiguous tool identities.
- [x] Commit and merge into prd without restarting services (implementation: 39bc0c7).

## Verification

- 429 test files / 2316 tests passed; backend, PC and App builds and lint passed.
- Read-only check of the reported history removed exactly 13 heartbeat placeholders
  from 25 process items, preserving all 12 other items and all database records.
- Reviewed session/turn isolation, terminal state protection, real tool ID collisions,
  lazy historical details and ordinary updates. No blocking findings remain.
- No deployment or PRD restart performed. Build emits existing chunk-size warnings.

## Acceptance

One long-running command remains one card through all heartbeats. Metadata and
output stay intact. Completion/failure wins over late heartbeats. Unknown
confirmed heartbeats produce diagnostics only. Normal tools with similar IDs or
temporarily missing titles remain visible. History is not rewritten.
