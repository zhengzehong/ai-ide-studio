# Desktop Dual Mode Implementation Plan

## Goal

Ship one Electron package that can either own a bundled local AI IDE Studio backend or act as a client for a remote AI IDE Studio server. Add a desktop-only connection settings section and a restart-applied Widget switch without changing browser behavior or server business data.

## Constraints

- Keep the existing managed local startup as one supported mode.
- Remote mode loads the server-hosted PC UI so HTTP and WebSocket remain same-origin.
- Store desktop preferences under Electron `userData`; do not add a server database migration.
- Protect saved remote tokens with Electron `safeStorage` when available.
- Apply mode, endpoint, credentials, and Widget changes after an application restart.
- Do not restart the running PRD service during implementation.

## Implementation

### 1. Connection profiles and startup target

- Add a typed Electron connection profile module with validation, persistence, credential protection, and managed-local defaults.
- Add a runtime target abstraction shared by the main window, Widget, tray, navigation, and shutdown paths.
- Refactor Electron startup to spawn the backend only for managed-local mode.
- Add unit tests for profile normalization, persistence, and target URL generation.

### 2. First launch and desktop settings

- Add an Electron-owned first-launch window for choosing local or remote mode.
- Validate remote origin and token before accepting the initial profile.
- Expose a narrow preload IPC bridge for reading desktop settings, testing a connection, and saving settings before relaunch.
- Add a separate desktop-only Settings component rather than growing the existing Settings page.
- Add the Widget enable switch and conditionally create Widget/tray actions.

### 3. Authentication, security, and packaging

- Initialize the renderer access token from the desktop bridge before UI data bootstrap.
- Remove the token query parameter after renderer initialization.
- Restrict in-app navigation to the selected server origin and open external links in the system browser.
- Update Electron build synchronization and packaging manifests for new modules.
- Update architecture/getting-started documentation for the two desktop modes.

## Validation

- Unit tests for Electron profiles, startup target selection, renderer bridge bootstrap, and desktop Settings state.
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run build:electron:main`
- `git diff --check`
- Independent code review before merging to `prd`.

## Acceptance Criteria

- A first Electron launch can choose managed local or remote mode.
- Remote mode does not start the bundled backend and loads the configured server.
- Desktop Settings can change mode, remote origin/token, and Widget enabled state, then relaunch.
- Widget and tray behavior use the active target and honor the switch.
- Browser builds show no desktop settings and retain current connection behavior.
- No server database migration is introduced.
