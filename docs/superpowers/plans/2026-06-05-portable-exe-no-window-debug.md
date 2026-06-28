# Portable EXE no-window debug

## Goal

Confirm why `AI IDE Studio 0.2.0.exe` starts background processes but does not show the frontend window, then decide whether the package must be fixed and rebuilt.

## Steps

1. Capture the currently running packaged process tree and executable paths.
2. Locate Electron/backend logs under AppData, temp extraction directories, and packaged `resources`.
3. Inspect the Electron packaging config and main-process startup path if logs point to a missing frontend or startup failure.
4. Apply the smallest necessary fix, rebuild, and smoke-test the produced `.exe`.

## Verification

- Packaged app opens a visible frontend window.
- Backend process starts and logs a healthy gateway startup.
- No leftover packaged backend process remains after closing the app.
