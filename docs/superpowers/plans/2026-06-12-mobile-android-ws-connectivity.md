# Mobile Android WS connectivity fix

## Goal

Fix the Android App staying in "connecting" when the PRD server is reachable from the phone browser, then rebuild the APK.

## Scope

- Allow the Capacitor Android WebView to connect to LAN `http/ws` services when the app is loaded from the local `https` scheme.
- Surface WebSocket connection errors immediately in the mobile connection store.
- Keep the existing web and PC behavior unchanged except for exposing connection failure events through the shared WebSocket client.

## Tasks

- [x] Add regression tests for immediate mobile connection failure.
- [x] Update Capacitor Android config for mixed content.
- [x] Update WebSocket client error handling.
- [x] Update mobile connection store failure handling.
- [x] Run focused tests, build, and APK packaging.
- [x] Commit the verified changes on `prd`.

## Verification

- `npx vitest run tests/unit/mobile-connection-store.test.ts`
- `npm run build`
- `.\scripts\build-mobile-android-debug.bat`
- `git diff --check`
