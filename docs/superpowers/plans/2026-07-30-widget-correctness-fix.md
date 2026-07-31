# Widget Correctness Fix

## Goal

Fix the first batch of Widget correctness defects without implementing the later attention-center redesign.

## Steps

1. Add tests for scoped Session URLs and navigation-before-read ordering.
2. Add a bounded recent Session read model using the shared PC read timestamp.
3. Return an explicit Electron navigation result and await page loading.
4. Keep completed rows after read and surface navigation/load errors.
5. Resolve stored Agent icon names through the existing icon map.
6. Replace Session-age duration and hard-coded connection state with truthful states.
7. Run targeted tests, full tests, lint, server/UI/mobile build, Electron build, and a packaged Widget smoke test.

## Acceptance

- Clicking a Widget Session opens `/p/<projectId>/workspace?sessionId=<sessionId>`.
- A failed navigation does not mark the Session read or remove its row.
- PC and Widget agree on message read state.
- The recent list is bounded and a read completed row remains visible.
- Icon names, running labels, connection state, loading, and failure feedback render correctly.
- No production database mutation or PRD restart is required.
