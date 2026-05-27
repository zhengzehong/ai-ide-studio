# Productionization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move AI IDE Studio from prototype storage/UX assumptions to a production-ready baseline with SQLite persistence, reliable session history, Markdown chat rendering, task lifecycle closure, and removal of misleading fake capabilities.

**Architecture:** Keep the current gateway/store public APIs stable while replacing the JSON file backend with SQLite and migration support. Treat `session_events` as the authoritative append-only event log and `messages` as a query/display snapshot. Keep feature optimizations mostly in UI/gateway validation so database migration can proceed in parallel with minimal conflicts.

**Tech Stack:** Node.js 24, TypeScript 6, Hono, ws, React 19, Zustand, Vite 8, SQLite via `better-sqlite3`, Markdown via `react-markdown` + `remark-gfm`.

---

## Parallel Work Split

### Worker A: SQLite migration and data model

**Ownership:** `package.json`, `package-lock.json`, `src/store/**`, store-related tests, minimal `src/entry.ts` config path if needed. Avoid editing `ui/src/**` except if TypeScript types require it. Do not revert existing ACP/session event changes.

**Deliverables:**
- Replace JSON-backed `src/store/db.ts` with SQLite initialization.
- Add migrations for `agents`, `sessions`, `messages`, `session_events`, `tasks`, `task_events`, `rules`.
- Preserve existing store APIs: `agentStore`, `sessionStore`, `messageStore`, `eventStore`, `taskStore`, `ruleStore`.
- Auto-migrate existing JSON `data/ai-ide.db` to new `data/ai-ide.sqlite`, backing up JSON first.
- Add tests proving migration and CRUD/list behavior.

**Verification commands:**
```bash
npm run build
npx tsx test-sqlite-migration.ts
npx tsx test-session-events.ts
npx tsx test-session-finalize.ts
npx tsx test-ws-capabilities.ts
```

### Worker B: Feature optimization and UX correctness

**Ownership:** `ui/src/**`, `src/gateway/ws-handler.ts`, `src/types/ws-protocol.ts`, `src/acp/adapters.ts`, targeted docs. Avoid editing `src/store/**` and `package-lock.json` except for adding Markdown dependencies in coordination; if dependencies are needed, update package files and report clearly.

**Deliverables:**
- Add Markdown rendering for chat output with GFM support and safe, layout-stable components.
- Disable unsupported runtime creation (`gemini`) in UI and validate runtime server-side.
- Improve task lifecycle UX hooks: task cards can open details and linked session path is visible; if backend task status APIs already exist, wire manual status transitions.
- Keep tool/thinking panels collapsed after completion and layout-stable for long commands/output.
- Update user-facing docs to describe actual capabilities and pending features.

**Verification commands:**
```bash
npm run build
npx tsx test-capability-merge.ts
npx tsx test-capability-state-merge.ts
```

---

## Integration Requirements

- [ ] Do not delete or overwrite existing uncommitted ACP/session work.
- [ ] Maintain current WebSocket protocol compatibility unless a test is updated with a deliberate schema change.
- [ ] Store API method signatures must remain compatible with current callers.
- [ ] SQLite file should be `data/ai-ide.sqlite`; old JSON `data/ai-ide.db` should remain as backup/source during migration.
- [ ] `session_events` remains authoritative for reconstructing tools/thinking/plan/permission/elicitation.
- [ ] `messages` remains a snapshot for quick history display.
- [ ] Docs must stop claiming unimplemented features are available.

## Final Verification

Run:
```bash
npm run build
npx tsx test-session-events.ts
npx tsx test-session-event-reducer.ts
npx tsx test-session-finalize.ts
npx tsx test-capability-merge.ts
npx tsx test-capability-state-merge.ts
npx tsx test-ws-capabilities.ts
npx tsx test-ws-fork.ts
npx tsx test-acp-verify.ts
npx tsx test-sqlite-migration.ts
git diff --check
```
