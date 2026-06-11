# Event Center UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the event center from a demo-like validation UI into a compact, paginated inbox with formal event and subscription creation flows.

**Architecture:** Add backend pagination to event listing while keeping AI tool behavior compatible. Replace inline/demo frontend controls with modal-based manual event creation and subscription-rule creation. Keep details in the side panel so the event list can remain dense.

**Tech Stack:** Hono/ws RPC, better-sqlite3, React 19, Zustand, Vitest, CSS variables.

---

### Task 1: Backend Event Pagination

**Files:**
- Modify: `src/store/event-center-events.ts`
- Modify: `src/core/event-center.ts`
- Modify: `src/gateway/rpc/event-center.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/integration/event-center-rpc.test.ts`

- [ ] Add a failing integration test for `events.list` returning `{ items, total, limit, offset }` when `limit` is provided.
- [ ] Implement `EventListFilter.limit`, `offset`, and `keyword`.
- [ ] Add `count()` query using the same filters.
- [ ] Add `eventCenterService.listEventsPage()` and keep `listEvents()` returning an array for tools.
- [ ] Update RPC `events.list` to return paginated payload when pagination inputs are present, otherwise preserve array response.

### Task 2: Frontend Store Pagination State

**Files:**
- Modify: `ui/src/stores/event-center.store.ts`

- [ ] Add event pagination state: `eventTotal`, `eventLimit`, `eventOffset`, `eventKeyword`, `eventStatus`.
- [ ] Update `fetchEvents()` to pass pagination/filter inputs and accept both legacy array and paginated payload.
- [ ] Keep `createEvent()` prepending the new event and refreshing totals through existing listeners.

### Task 3: Formal Event Creation Modal

**Files:**
- Create: `ui/src/pages/event-center/EventCreateModal.tsx`
- Modify: `ui/src/pages/event-center/EventInboxPanel.tsx`
- Modify: `ui/src/pages/event-center/event-center.css`

- [ ] Remove the hardcoded simulation action.
- [ ] Add a `新建事件` button that opens a modal.
- [ ] Validate category and title before submit.
- [ ] Submit `sourceType: 'manual'`, `sourceLabel: '人工录入'`, and structured tags/payload/evidence.
- [ ] Show backend errors in the modal.

### Task 4: Compact Event List With Pagination

**Files:**
- Modify: `ui/src/pages/event-center/EventInboxPanel.tsx`
- Modify: `ui/src/pages/event-center/event-center.css`

- [ ] Replace card list with a compact table as the default view.
- [ ] Add `表格 / 摘要` view switch; keep table default.
- [ ] Add page size and previous/next pagination controls.
- [ ] Keep status/category/search filters, with searches going through backend keyword filter.

### Task 5: Subscription Creation Modal

**Files:**
- Create: `ui/src/pages/event-center/SubscriptionCreateModal.tsx`
- Modify: `ui/src/pages/event-center/SubscriptionPanel.tsx`
- Modify: `ui/src/pages/event-center/event-center.css`

- [ ] Remove inline quick-create controls.
- [ ] Add `新建订阅规则` modal.
- [ ] Require name, category, and consumer Agent.
- [ ] Support min confidence, priority filter, source type filter, and enabled state.
- [ ] Show validation and backend errors.

### Task 6: Documentation And Verification

**Files:**
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`

- [ ] Document paginated `events.list`.
- [ ] Run targeted tests.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Commit only files changed for this task.
- [ ] Cherry-pick or merge the commit into the PRD worktree and run verification there.
