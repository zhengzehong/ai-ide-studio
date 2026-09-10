# Model proxy Runtime bindings

## Scope

Replace per-request profile resolution with immutable, in-memory connection bindings resolved by the launch path. Cover process and embedded Runtime, Claude and Codex. No database migration, production restart, or production asset build.

Platform task tools are unavailable in this session; this checklist tracks the implementation locally.

## Checklist

- [x] Add failing regressions for inherited profiles, connection drift and proxy readiness.
- [x] Build stable route descriptors from the effective profile; register only for Runtime use.
- [x] Retain routes across pending startup, active Runtime and in-flight HTTP requests; release on result, stop, failure and process exit.
- [x] Remove legacy Host map lookup; reject obsolete routes explicitly.
- [x] Verify unchanged configuration reuse, provider URL/key changes, model passthrough, unavailable proxy fallback, independent process Runtime.
- [x] Update architecture documentation; run tests, build, lint and review diff.
- [x] Commit and merge into prd while preserving unrelated changes.

## Acceptance

Team overrides and inherited profiles use the same upstream selected at Runtime startup. Changing database selections cannot redirect existing Runtime requests. New effective connections change the Runtime fingerprint. Disabled/unavailable capture keeps direct routing. No new UI or public RPC.

## Review notes

- The initial failing regressions proved that both Claude and Codex fingerprints hid provider URL changes and injection ignored listener readiness.
- A second regression exposed leader member-level profile overrides being omitted from member inheritance. Resolution now uses that override before the leader Agent/global setting.
- Independent-process tests use a local ACP fixture and HTTP upstream, exercising the actual ProcessRuntimePort, IPC, SDK host, launch environment and proxy. They cover startup requests, unchanged-config reuse, model passthrough, provider replacement, Runtime termination/restart, and shutdown cleanup. They do not contact production providers.
- Legacy host-state import and per-request profile resolution have been removed from the proxy. Existing idle-before-replacement scheduling and public interfaces are preserved.
- Baseline validation: 444 files / 2458 tests passed; production build and lint passed. Build reports the existing bundle-size advisory only. No production provider requests or service restarts.
- Final validation on PRD base c011749: 446 files / 2473 tests passed; build, lint and diff checks passed. Feature commit: 398037f. Merge applied without conflicts; pre-existing local modifications are excluded. Running API/Runtime processes and production build artifacts retain their original startup/write times.
