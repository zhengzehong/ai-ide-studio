# Event Center Product Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the event center from a developer/demo panel into a business-facing event workflow UI.

**Architecture:** Keep the existing event center storage model, including flexible `payload_json`, `confidence`, and `evidence_json`, so agent/tool integrations remain compatible. Add only the missing category deletion guard on the backend, then hide internal fields from the default UI and render category schemas as ordinary form fields.

**Tech Stack:** Hono RPC handlers, better-sqlite3 stores, Vitest integration tests, React 19, Zustand, CSS variables.

---

### Task 1: Category Deletion Guard

**Files:**
- Modify: `tests/integration/event-center-rpc.test.ts`
- Modify: `src/store/event-categories.ts`
- Modify: `src/core/event-center.ts`
- Modify: `src/gateway/rpc/event-center.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `docs/architecture/ws-protocol.md`

- [ ] Add a failing integration test for deleting an unused custom category and rejecting deletion when events reference it.
- [ ] Implement `eventCategoryStore.remove()` with reference counts from `event_center_events` and `event_subscriptions`.
- [ ] Add `eventCenterService.deleteCategory()` and `eventCategories.delete` RPC.
- [ ] Update protocol docs.

### Task 2: Business Event Form

**Files:**
- Modify: `ui/src/pages/event-center/EventCreateModal.tsx`
- Modify: `ui/src/pages/event-center/helpers.ts`
- Modify: `ui/src/pages/event-center/event-center.css`

- [ ] Remove visible confidence, evidence, and raw payload JSON inputs.
- [ ] Add an event description/reason textarea backed by existing `summary`.
- [ ] Render selected category schema properties as normal fields and submit them as `payload`.
- [ ] Keep manual events compatible by sending `sourceType: manual`, `sourceLabel`, priority, tags, and `confidence: 1`.

### Task 3: Event Inbox and Detail Polish

**Files:**
- Modify: `ui/src/pages/event-center/EventInboxPanel.tsx`
- Modify: `ui/src/pages/event-center/EventDetailPanel.tsx`

- [ ] Remove confidence from the table and summary side column.
- [ ] Rename dynamic fields to category fields.
- [ ] Remove default evidence and system-field sections from the business detail view.
- [ ] Keep consumption records and operational actions visible.

### Task 4: Category Management Modal

**Files:**
- Create: `ui/src/pages/event-center/CategoryCreateModal.tsx`
- Modify: `ui/src/pages/event-center/CategoryPanel.tsx`
- Modify: `ui/src/stores/event-center.store.ts`
- Modify: `ui/src/pages/event-center/event-center.css`

- [ ] Replace inline category creation with a modal form.
- [ ] Support name, ID, description, default priority, enabled state, and field-template rows.
- [ ] Allow editing existing categories through the same modal.
- [ ] Add delete action for unused categories and show backend rejection if referenced.
- [ ] Hide raw `schema_json` from the default category detail pane.

### Task 5: Subscription Presentation

**Files:**
- Modify: `ui/src/pages/event-center/SubscriptionPanel.tsx`
- Modify: `ui/src/pages/event-center/SubscriptionCreateModal.tsx`
- Modify: `ui/src/pages/event-center/helpers.ts`

- [ ] Display `create_pending` as `创建待处理记录`.
- [ ] Split action mode into its own column so it does not wrap under the rule name.
- [ ] Remove minimum confidence from the creation form and filter JSON.
- [ ] Keep priority and source-type filters.

### Task 6: Verification and Integration

**Files:**
- Run verification only unless failures require fixes.

- [ ] Run `npm run test:integration -- tests/integration/event-center-rpc.test.ts`.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Commit only event-center related files, then cherry-pick/update PRD without touching unrelated files.
