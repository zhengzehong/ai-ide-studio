# Event Consumer Session Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Event subscriptions can choose a consumer session strategy, auto-start matching consumptions, and queue auto-started work predictably.

**Architecture:** Store the chosen strategy on `event_subscriptions`, store the actual dispatched session on `event_consumptions`, and resolve the session inside `eventCenterService.runConsumer()`. Auto-start uses the same run path and chains work per subscription so fixed-session creation is stable and repeated events do not race each other.

**Tech Stack:** TypeScript, Hono RPC handlers, better-sqlite3 migrations, Zustand/React UI, Vitest.

---

### Task 1: Backend Contract Tests

**Files:**
- Modify: `tests/unit/event-center-service.test.ts`
- Modify: `tests/integration/event-center-rpc.test.ts`
- Modify: `tests/unit/event-center-tools.test.ts`

- [ ] **Step 1: Write failing service tests**

Add coverage that `runConsumer()` can use an explicitly selected existing session, that `new_fixed` stores and reuses the fixed session, and that `autoStart` schedules a pending consumption automatically.

- [ ] **Step 2: Write failing RPC/tool tests**

Add coverage that `eventSubscriptions.create` and `event.subscription.create` accept and return `autoStart`, `consumerSessionMode`, and `consumerSessionId`.

- [ ] **Step 3: Run targeted tests and confirm RED**

Run:

```bash
npm test -- tests/unit/event-center-service.test.ts tests/integration/event-center-rpc.test.ts tests/unit/event-center-tools.test.ts
```

Expected: fail because the fields and behavior do not exist yet.

### Task 2: Database and Store Support

**Files:**
- Create: `src/store/migrations/019-event-consumer-session-strategy.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/event-subscriptions.ts`
- Modify: `src/store/event-consumptions.ts`
- Modify: `tests/integration/sqlite-migration.test.ts`

- [ ] **Step 1: Add migration**

Add nullable/compatible columns:

```sql
ALTER TABLE event_subscriptions ADD COLUMN consumer_session_mode TEXT NOT NULL DEFAULT 'new_each';
ALTER TABLE event_subscriptions ADD COLUMN consumer_session_id TEXT;
ALTER TABLE event_consumptions ADD COLUMN session_id TEXT;
```

Guard each `ALTER TABLE` with `PRAGMA table_info` checks.

- [ ] **Step 2: Update stores**

Expose:

```ts
type EventConsumerSessionMode = 'existing' | 'new_each' | 'new_fixed'
```

Add row/input fields and store helpers to persist `consumer_session_id` and `session_id`.

- [ ] **Step 3: Run migration/store tests**

Run:

```bash
npm test -- tests/integration/sqlite-migration.test.ts
```

Expected: pass after migration registration and expected-version update.

### Task 3: Service, RPC, and MCP Behavior

**Files:**
- Modify: `src/core/event-center.ts`
- Modify: `src/gateway/rpc/event-center.ts`
- Modify: `src/tools/handlers/event-center-tools.ts`

- [ ] **Step 1: Resolve sessions in one place**

`runConsumer()` should accept either a string consumption id or:

```ts
{ consumptionId: string; sessionId?: string }
```

Resolution rules:

- `sessionId` wins and must belong to the consumer agent/project.
- `existing` requires `consumer_session_id`.
- `new_fixed` reuses `consumer_session_id`, or creates one and writes it back.
- `new_each` creates a fresh session.

- [ ] **Step 2: Use queued prompt dispatch**

Dispatch through `sessionManager.enqueuePrompt()` so existing/fixed sessions do not reject while busy.

- [ ] **Step 3: Auto-start matching subscriptions**

When `auto_start = 1`, schedule `runConsumer()` for the created consumption. Chain auto-runs per subscription id to avoid fixed-session races and to process new matching events one by one at the subscription level.

- [ ] **Step 4: Forward fields through RPC/MCP**

Forward `autoStart`, `consumerSessionMode`, and `consumerSessionId` in subscription creation. Forward optional `sessionId` in `eventConsumptions.run`.

- [ ] **Step 5: Run targeted backend tests**

Run:

```bash
npm test -- tests/unit/event-center-service.test.ts tests/integration/event-center-rpc.test.ts tests/unit/event-center-tools.test.ts
```

Expected: pass.

### Task 4: Frontend Subscription UI

**Files:**
- Modify: `ui/src/stores/event-center.store.ts`
- Modify: `ui/src/pages/event-center/SubscriptionCreateModal.tsx`
- Modify: `ui/src/pages/event-center/SubscriptionPanel.tsx`
- Modify: `ui/src/pages/event-center/EventDetailPanel.tsx`

- [ ] **Step 1: Extend frontend data types**

Add `consumer_session_mode`, `consumer_session_id`, and `session_id`.

- [ ] **Step 2: Add create-modal controls**

Expose:

- auto consume toggle.
- session strategy select: fixed new session, new session each time, existing session.
- existing-session select filtered by the chosen consumer Agent and current project.

- [ ] **Step 3: Show saved strategy and actual consumption session**

Subscription detail should show auto-consume and the configured session strategy. Event consumption rows should show the session actually used when available.

### Task 5: Docs, Verification, Commit, PRD Update

**Files:**
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `README.md`

- [ ] **Step 1: Update docs**

Document the new subscription fields, consumption `session_id`, RPC parameters, and auto-consume behavior.

- [ ] **Step 2: Full verification**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

- [ ] **Step 3: Commit only this task**

Stage only files changed for this feature and commit with:

```bash
git commit -m "feat: add event consumer session strategies"
```

- [ ] **Step 4: Update PRD branch**

Cherry-pick the commit into `D:\code_space\python_space\ai-ide-studio-prd`, resolve only feature conflicts, and run targeted verification there.
