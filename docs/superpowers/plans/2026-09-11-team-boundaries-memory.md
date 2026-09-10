# Team communication boundaries and native memory isolation

## Scope

Separate Agent and team discovery. Route external messages through a team's Master,
reuse persistent contact conversations, and enforce tool access using the caller's
Session identity. Keep user-facing team inspection available. Isolate Claude native
memory by project and Agent; disable Codex native memory in platform runtimes.
Team members use dedicated identities, including safe handling of legacy reuse.

## Checklist

- [x] Add reproduction coverage for native memory settings and dedicated members.
- [x] Implement shared native memory policy and dedicated member creation.
- [x] Add persistent external contacts, team conversation tool, and Master routing.
- [x] Enforce discovery, history, communication, session and task boundaries.
- [x] Handle legacy member identities without rewriting historical messages/native mappings.
- [x] Update tool guidance and architecture documentation; user UI remains on existing RPCs.
- [x] Run targeted tests, full tests, lint, build and diff checks.
- [x] Review final diff and regressions.

Delivery: commit this isolated branch and merge it into prd without deploying or restarting services.

## Acceptance

External callers see public team metadata only. Messages and replies resolve to the
same contact after restart; concurrent first messages do not create duplicate lines.
Ordinary members cannot send outside their team, while Master replies and internal
mailbox/task dispatch work. Closed contacts fail explicitly. Agent tools cannot
bypass boundaries with known IDs, task steps, watches or session operations.
User RPC inspection retains internal history. Runtime settings apply on new,
resumed and cloned sessions without moving authentication or transcript homes.

## Operational constraints

Use this isolated worktree and test DATA_DIR/LOG_DIR. Do not restart production,
launch standalone application servers, replace production build assets, or mutate
the online database. Schema/data transitions run only during later deployment.
Preserve unrelated main-worktree changes. No replyToMessageId or mixed directory.

## Baseline and review

Baseline: prd 8fa80a9. Platform task tools and files.present are unavailable in this environment.

## Review and validation results

- Full regression: 451 files / 2510 tests passed (`npm test`).
- `npm run lint`, `npm run build`, `npx tsc --noEmit`, and `git diff --check` passed.
- Native memory tests cover per-identity directories, unrelated Codex config preservation,
  invalid input, and fresh/resumed Runtime snapshots. Installed claude-agent-acp 0.60.0
  forwards the SDK settings object; installed Claude SDK declares autoMemoryDirectory.
  No production model request or production DB operation was used for validation.
- Contact tests cover concurrent creation, repeat sends, team-to-team reverse contact,
  public sender identity, needReply suppression, archived contacts, and real tool schema/runtime dispatch.
- Boundary tests cover known IDs, forged contexts, both task lists, historical watches,
  deferred inbound/outbound dispatch rejection, and legitimate internal dispatch.
- Identity transition tests cover unchanged messages/native IDs, idempotence, busy deferral,
  cross-team identity reuse, ambiguous shared sessions, ordinary standalone sessions,
  generic-task execution continuation, and terminal-task preservation.
- Final review fixed private response leakage from team.create/send, target teamId hidden
  by schema sanitization, reverse contact lookup, pre-creation dispatch validation,
  and migration ordering before task/wake recovery.
- One intermediate full run hit a Windows EPERM while an existing model-proxy-runtime
  test removed its temporary directory. The final full regression passed unchanged.
  Build reports existing large frontend chunk warnings; build exits successfully.

## Deployment limits

Only source is merged. Migration 069 and identity reconciliation take effect on the next
normal backend deployment/start. Existing native transcripts and already-injected memories
are retained. Native directory separation is not a filesystem permission sandbox.
See `docs/guides/team-identity-upgrade.md` for data behavior and acceptance steps.
