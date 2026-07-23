# Message Sync Indicator Implementation Plan

**Goal:** Keep cached chat content visible while clearly showing that the selected Session is synchronizing, and ensure persisted messages load before recovery metadata.

## Scope

- Show one inline `正在同步消息...` indicator below cached chat items while the current Session messages request is active.
- Fetch messages before Session recovery when selecting or restoring a Session.
- Keep existing first-load, error, retry, cache, and Realtime behavior unchanged.
- Do not change backend APIs, SQLite, mobile, or `AGENTS.md`.

## Steps

1. Add a failing load-state test for cached content plus an active messages refresh.
2. Add a failing Session store test proving recovery does not start before messages settle.
3. Add a small pure helper in `ui/src/pages/workspace/load-state.ts` and use it from Workspace.
4. Render an inline spinner below the message list with the single label `正在同步消息...`.
5. Chain `fetchRecovery` after `fetchMessages` in both Session selection paths.
6. Run focused tests, TypeScript, lint, build, full tests, bundle gate, and diff checks.

## Acceptance

- Cached messages remain visible during synchronization.
- A visible inline loading state remains present for the duration of a cached-message refresh.
- The UI uses only `正在同步消息...` for this state.
- Messages are requested before recovery.
- No backend, database, mobile, or `AGENTS.md` changes.
