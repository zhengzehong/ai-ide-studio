# Widget controls and exit behavior

## Goal

Refine the desktop Widget based on production visual feedback and make closing the main desktop window exit the application.

## Changes

1. Increase the Widget surface opacity while retaining a restrained frosted effect.
2. Read and display the real Electron always-on-top state. Make pinned and unpinned states visually distinct.
3. Remove the top activity toolbar. Move status filtering to a compact footer button that cycles through all, running, needs-input, and completed states.
4. Constrain the project selector so its native dropdown indicator stays near the project label.
5. Quit Electron when the main window closes, allowing `before-quit` to clean up the Widget, tray, and managed backend.
6. Rebuild and package into a new release directory without stopping the existing PRD service.

## Verification

- Unit tests cover filter cycling, pin-state IPC behavior, pin-button state presentation, and main-window close handling.
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run build:electron:main`
- `git diff --check`
- Electron packaging completes and the unpacked resources contain the new Widget assets.

