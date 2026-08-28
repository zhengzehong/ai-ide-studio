# Runtime Session Rebind After Agent Profile Restart

## Goal

Keep the current conservative runtime behavior: wait for all active turns of an Agent before replacing its ACP process, then rebind Sessions to the new process without reusing stale ACP Session IDs.

## Scope

1. Add a regression test covering an idle Session sending after an Agent runtime restart.
2. Update `SdkRuntimeHost.ensureSessionInternal` to re-read the Session runtime mapping after `ensureAgent` completes and discard the pre-restart object.
3. Reuse the existing resume/recreate policy and persist the newly opened ACP Session ID through the existing session lifecycle.
4. Verify targeted runtime tests, full tests, lint, TypeScript, build, and diff checks.

## Acceptance criteria

- Active turns still finish before the old Agent runtime is stopped.
- Platform Session records and message history are not deleted.
- A Session after restart never returns a stale ACP Session ID.
- Missing native Session recovery follows the existing `canRecreateMissingSession` policy.
- No RPC, database migration, or frontend changes are introduced.
