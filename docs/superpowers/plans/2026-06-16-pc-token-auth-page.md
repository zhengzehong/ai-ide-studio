# PC Token Auth Page

## Goal

When the backend has no local token configured, the PC web UI should keep working without a token. When the backend rejects the WebSocket/API as unauthorized, the PC web UI should show a small access-token page, save the token locally, and reconnect with it.

## Steps

1. Add connection tests for URL token resolution, saved token reuse, and unauthorized close handling.
   - Verify: targeted Vitest test fails before implementation and passes after.
2. Extend the PC WebSocket client/store to surface unauthorized closes and reconnect with a saved token.
   - Verify: no-token URL remains unchanged when no token is saved.
3. Add a compact PC token entry page and render it only after unauthorized connection feedback.
   - Verify: TypeScript build passes.
4. Review the diff for scope and run focused tests.
   - Verify: `npm test -- tests/unit/pc-connection-auth.test.ts` and UI build.
