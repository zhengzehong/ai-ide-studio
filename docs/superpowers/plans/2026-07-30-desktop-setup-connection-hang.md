# Desktop Setup Connection Hang

## Goal

Ensure the Electron first-run connection form always completes with either a successful transition or a clear error. A failed or stalled IPC request must never leave the button permanently showing "正在连接...".

## Diagnosis

1. Reproduce against the packaged Electron application with an isolated user data directory.
2. Verify the remote server health and desktop compatibility endpoint independently.
3. Trace setup renderer submission, preload IPC invocation, main-process validation, and window transition.

## Implementation

1. Extract the setup submission timeout/result handling into a testable helper.
2. Add a renderer-side deadline and `try/catch/finally` state restoration.
3. Make the main-process setup handler validate stable sender properties and defer closing the setup window until the IPC reply can be delivered.
4. Add structured Electron main-process diagnostics without logging tokens.

## Verification

1. Add regression tests for success, server rejection, thrown IPC errors, and never-resolving IPC calls.
2. Run targeted Electron tests.
3. Run `npm test`, `npm run lint`, `npm run build`, and `npm run build:electron:main`.
4. Build a new portable package without replacing the user's running executable.

## Acceptance

- A healthy `http://localhost:18900` connection opens the main client.
- Invalid or unreachable connections show a Chinese error within 10 seconds.
- The submit button is re-enabled after every failure.
- Existing local/remote profiles, Web mode, and Widget behavior remain unchanged.
