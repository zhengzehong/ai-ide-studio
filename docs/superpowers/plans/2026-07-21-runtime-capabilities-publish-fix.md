# Runtime capabilities publish fix

## Goal

Restore capability updates for process-based ACP runtimes after model, mode, or config preferences are changed so the PC UI immediately reflects the accepted value.

## Scope

- Add a lifecycle regression test proving `setConfig` publishes the merged capabilities.
- Publish the current Session capabilities after successful `setModel`, `setMode`, and `setConfig` calls.
- Keep the existing `AcpRuntimeHost` option forwarding unchanged because it already passes the complete options object to `SdkRuntimeHost`.

## Steps

1. Add the failing `setConfig` publish regression test and confirm it fails for the missing callback.
2. Add the minimal publish calls to the three SDK preference setters.
3. Run the targeted test, lint, production build, full test suite, and `git diff --check`.
4. Commit on the isolated fix branch, obtain code review approval, then merge into `prd` without restarting services.

## Acceptance

- The callback receives the application Session ID and capabilities containing the accepted config value.
- Model and mode changes publish their updated current IDs only after the ACP operation succeeds.
- Build, lint, and all tests pass.
