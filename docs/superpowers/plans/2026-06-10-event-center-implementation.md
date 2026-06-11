# Event Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Event Center that lets system triggers and Agents create categorized events, lets users manage categories and subscriptions, and lets subscribed Agents consume events or convert them to tasks.

**Design Doc:** `docs/design/event-center.md`

**Architecture:** Add Event Center as a new domain beside tasks, sessions, rules, and teams. Events are business signals, not chat `session_events`. Store fixed event metadata in SQLite columns and category-specific data in `payload_json`. Use subscriptions to create consumption records and optionally launch Agent sessions.

**Tech Stack:** Hono WebSocket RPC, better-sqlite3 stores/migrations, mitt events, platform MCP tools, React 19 + Zustand, Vitest.

---

## Phase 1 Scope: Minimal Complete Loop

Phase 1 should ship a complete but conservative loop:

```text
User defines category/subscription
  -> Agent writes event through tool
  -> Event appears in Event Center
  -> Matching subscription creates a pending consumption
  -> Consumer Agent claims or is manually started from UI
  -> Agent writes consumption result
  -> User can ignore, archive, or convert the event to a task
```

Phase 1 should support auto-created pending consumptions, but automatic background Agent execution can be limited to an explicit "run consumer" action or a subscription `autoStart` flag. External webhooks, advanced dedupe clustering, and complex source connectors are out of scope for Phase 1.

### Phase 1 Supported Event Categories

Seed these categories so the feature has useful defaults:

1. `ai.hot_project` / AI 热门项目
   - Source: AI collector or manual Agent tool call.
   - Payload examples: project name, GitHub URL, stars, star delta, hot reason, related tech, recommended action.
   - Default behavior: collect and summarize; do not auto-create tasks.

2. `repo.commit` / 代码提交
   - Source: system, Agent tool call, or manual entry.
   - Payload examples: repo, branch, commit hash, author, message, changed files, recommended action.
   - Default behavior: hand to release-note or review Agent for summary.

3. `task.candidate` / 任务候选
   - Source: code review Agent, research Agent, user, or system scan.
   - Payload examples: background, suggested action, impact, priority, confidence.
   - Default behavior: wait for human confirmation or PM Agent triage before converting to task.

4. `work.shipped` / 工作完成
   - Source: Agent after commit, manual record, or future system commit hook.
   - Payload examples: commit, branch, files changed, summary, verification commands, follow-up suggestion.
   - Default behavior: feed release note or daily summary Agent.

### Phase 1 UI Shape

Add an Event Center page with three tabs:

1. `事件中心`
   - Left filter rail: 全部、未处理、处理中、已消费、已忽略、已转任务、已归档、我的订阅.
   - Main list: dense event rows/cards with category, title, summary, source, priority, confidence, status, created time.
   - Right detail panel: payload JSON rendered by category schema, evidence, consumption history, related task/session links.
   - Actions: 忽略、归档、交给 Agent、重新消费、转任务、关联任务.

2. `事件类别`
   - Table of category key, name, enabled state, allowed writers, allowed consumers.
   - Detail editor for description, payload schema JSON, default priority, permission lists.
   - Seed categories are editable but protected from hard delete if events exist.

3. `订阅规则`
   - Table of rules with category, filter summary, consumer Agent, action mode, enabled state.
   - Rule editor with simple first-stage conditions:
     - category
     - priority
     - confidence threshold
     - source type
     - tags contains
   - Action modes:
     - create pending consumption
     - manual run consumer
     - auto start consumer session if `autoStart` is enabled
     - create draft task is deferred unless explicitly chosen from an event.

### Phase 1 Interaction Loop

1. User opens Event Center and creates or edits `AI 热门项目`.
2. User creates a subscription: `AI 热门项目` -> `AI 项目分析 Agent` -> create pending consumption.
3. A collector Agent calls `event.create` with category `ai.hot_project`.
4. Backend validates category permission, validates payload schema, stores the event, evaluates subscriptions, and creates pending consumption records.
5. Event Center shows the event as `未处理` with a pending consumer.
6. User clicks `运行消费者`, or the consumer Agent calls `event.claim_next`.
7. Consumer Agent analyzes the event and calls `event.consume` with result summary and optional result JSON.
8. Event Center shows consumption result and updates event status to `已消费`.
9. User can click `转任务`; backend creates a normal Task with `source = event` or equivalent link metadata and stores the event-task link.

---

## Task 1: Data Model And Stores

**Files:**
- Create: `src/store/migrations/014-event-center.ts`
- Modify: `src/store/migrations/index.ts`
- Create: `src/store/event-categories.ts`
- Create: `src/store/events.ts`
- Create: `src/store/event-subscriptions.ts`
- Create: `src/store/event-consumptions.ts`
- Test: `tests/unit/event-center-store.test.ts`
- Test: `tests/integration/sqlite-migration.test.ts`

- [ ] Add tables:
  - `event_categories`
  - `event_center_events`
  - `event_subscriptions`
  - `event_consumptions`
  - `event_task_links`
- [ ] Use fixed columns for shared metadata and `payload_json` / `schema_json` for category-specific data.
- [ ] Add indexes for project/user scope, category, status, created time, dedupe key, subscription status.
- [ ] Seed Phase 1 default categories idempotently.
- [ ] Implement CRUD stores with explicit types and no direct cross-module DB access.
- [ ] Add migration tests proving a fresh DB and upgraded DB both include Event Center tables.

**Acceptance:**
- Fresh database contains Event Center schema and default categories.
- Duplicate category keys are rejected or upserted safely.
- Events can be stored with fixed metadata plus dynamic payload.

---

## Task 2: Domain Service

**Files:**
- Create: `src/core/event-center.ts`
- Modify: `src/core/events.ts`
- Test: `tests/unit/event-center-service.test.ts`

- [ ] Implement `createEvent(input)`:
  - validate category exists and enabled
  - validate writer permission
  - validate required fixed fields
  - validate payload against category schema where practical
  - apply dedupe key if present
  - persist event
  - evaluate matching subscriptions
  - create pending consumption records
  - emit `event-center:update`
- [ ] Implement status operations:
  - ignore
  - archive
  - mark consumed
  - reopen
- [ ] Implement subscription evaluation for Phase 1 filters.
- [ ] Implement `claimNextEvent(agentId, filters)` using consumption rows and a claim token.
- [ ] Implement `consumeEvent(consumptionId, result)` with idempotent completion.
- [ ] Implement `convertEventToTask(eventId, taskInput)` and create `event_task_links`.

**Acceptance:**
- Creating an event creates pending consumptions for matching subscriptions.
- A consumer can claim one event once.
- Completing a consumption updates visible event status without deleting event history.
- Converting to task creates a normal task and links it back to the event.

---

## Task 3: WebSocket RPC

**Files:**
- Create: `src/gateway/rpc/event-center.ts`
- Modify: `src/gateway/rpc/registry.ts`
- Modify: `src/gateway/ws-handler.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/integration/event-center-rpc.test.ts`

- [ ] Add category RPC:
  - `eventCategories.list`
  - `eventCategories.create`
  - `eventCategories.update`
  - `eventCategories.toggle`
- [ ] Add event RPC:
  - `events.list`
  - `events.get`
  - `events.create`
  - `events.ignore`
  - `events.archive`
  - `events.convertToTask`
- [ ] Add subscription RPC:
  - `eventSubscriptions.list`
  - `eventSubscriptions.create`
  - `eventSubscriptions.update`
  - `eventSubscriptions.toggle`
  - `eventSubscriptions.delete`
- [ ] Add consumption RPC:
  - `eventConsumptions.claimNext`
  - `eventConsumptions.consume`
  - `eventConsumptions.retry`
- [ ] Broadcast `event-center:update` so open Event Center pages can refresh incrementally.

**Acceptance:**
- Frontend can list/create events, categories, subscriptions, and consumption results through WS RPC.
- RPC handlers validate project scope and do not expose events outside the active project/user scope.

---

## Task 4: Agent Tools

**Files:**
- Create: `src/tools/handlers/event-center-tools.ts`
- Modify: `src/tools/seed.ts`
- Modify: `src/tools/types.ts` if needed
- Test: `tests/unit/event-center-tools.test.ts`

- [ ] Add platform tools:
  - `event.category.list`
  - `event.create`
  - `event.list`
  - `event.get`
  - `event.claim_next`
  - `event.consume`
  - `event.convert_to_task`
  - `event.ignore`
- [ ] Sanitize schemas so Agents see only allowed inputs.
- [ ] Enforce category writer/consumer permissions from the current tool context.
- [ ] Include category schema hints in `event.category.list` so Agents know how to shape payload JSON.
- [ ] Keep high-risk actions conservative:
  - `event.create` is broadly useful.
  - `event.convert_to_task` should respect category/Agent permission and may require higher permission level.

**Acceptance:**
- An Agent can write a valid `ai.hot_project` event through `event.create`.
- A subscribed Agent can claim a matching event and call `event.consume`.
- An Agent cannot write disabled or unauthorized categories.

---

## Task 5: Frontend Store

**Files:**
- Create: `ui/src/stores/event-center.store.ts`
- Create: `ui/src/types/event-center.ts` or extend existing shared types
- Test: `tests/unit/event-center-store-ui.test.ts`

- [ ] Add state for:
  - events
  - selectedEventId
  - categories
  - subscriptions
  - consumptions by event id
  - loading/error maps
  - filters
- [ ] Add actions:
  - fetchEvents
  - fetchEventDetail
  - createCategory/updateCategory/toggleCategory
  - createSubscription/updateSubscription/toggleSubscription
  - ignore/archive/convertToTask
  - runConsumer or create consumption retry
- [ ] Listen for `event-center:update` and refresh affected event/category/subscription rows.

**Acceptance:**
- Event Center store can load and update events without touching session/task stores except for explicit convert-to-task refresh.

---

## Task 6: Event Center UI

**Files:**
- Create: `ui/src/pages/EventCenter.tsx`
- Create: `ui/src/components/event-center/EventList.tsx`
- Create: `ui/src/components/event-center/EventDetail.tsx`
- Create: `ui/src/components/event-center/EventCategoryManager.tsx`
- Create: `ui/src/components/event-center/EventSubscriptionManager.tsx`
- Modify: `ui/src/App.tsx`
- Modify: navigation component used by Workspace shell
- Test: focused UI helper tests where practical

- [ ] Add `事件中心` route and navigation entry.
- [ ] Build three tabs:
  - 事件中心
  - 事件类别
  - 订阅规则
- [ ] Event Center tab:
  - dense list, right detail panel, stable filters
  - no marketing layout, no nested cards
  - payload rendered according to category schema when available, raw JSON fallback
- [ ] Category tab:
  - category table and side/editor modal
  - schema JSON editor with validation feedback
- [ ] Subscription tab:
  - rule list and editor
  - first-stage condition builder
  - action mode selector
- [ ] Event actions:
  - ignore
  - archive
  - run consumer
  - convert to task
  - reopen

**Acceptance:**
- User can create a category, create a subscription, see an AI-created event, run a consumer, view result, and convert to task without leaving Event Center.

---

## Task 7: Optional Auto-Start Consumer Sessions

**Files:**
- Modify: `src/core/event-center.ts`
- Modify: `src/core/sessions.ts` only through public service APIs
- Test: `tests/integration/event-center-auto-consume.test.ts`

- [ ] Add subscription `autoStart` flag.
- [ ] When a matching event is created and `autoStart` is true, create a session for the consumer Agent and send a composed prompt that includes:
  - event title
  - summary
  - category schema
  - payload JSON
  - required output contract: call `event.consume` when done
- [ ] Guard against loops:
  - per-subscription rate limit
  - no auto-start if an identical pending/running consumption already exists
  - no auto-start if event was produced by the same consumer Agent unless explicitly allowed

**Acceptance:**
- A low-risk subscription can auto-start a consumer Agent and record the result.
- Auto-start cannot create an infinite event -> Agent -> event loop in tests.

---

## Task 8: First System Producers

**Files:**
- Modify only after Phase 1 loop is stable:
  - task completion path
  - commit/manual work shipped path if available
  - schedule/rule execution path
- Tests depend on chosen producers.

- [ ] Add `work.shipped` helper that can be called after commit-oriented workflows.
- [ ] Add `task.candidate` event creation from Agent tools only in Phase 1.
- [ ] Defer full Git hook / CI / external webhook ingestion to Phase 2.

**Acceptance:**
- The system can produce at least one non-manual event type without relying on external services.

---

## Verification

- [ ] `npm test -- tests/unit/event-center-store.test.ts tests/unit/event-center-service.test.ts tests/unit/event-center-tools.test.ts`
- [ ] `npm test -- tests/integration/event-center-rpc.test.ts`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Browser smoke:
  - create category
  - create subscription
  - create event through test tool/RPC
  - run consumer
  - convert event to task
  - verify task board shows the new task

---

## Phase 2: Stronger Producers And Better Automation

- Add system producers for repository commits, test failures, build results, task completion, session completion, and PRD sync events.
- Add scheduled collector Agent templates for AI trends and GitHub hot projects.
- Add digest mode for daily/weekly summary Agents.
- Add payload-path filters such as `payload.starsDelta > 1000`.
- Add category-level rate limits and dedupe windows.

---

## Phase 3: External Integrations

- Add webhook ingestion for GitHub, CI, monitoring, DingTalk/Feishu, RSS, and custom HTTP sources.
- Add source verification and signature validation where possible.
- Add source-specific event mapping into existing categories.
- Add attachment/evidence support for screenshots, links, and external report snapshots.

---

## Phase 4: Advanced Event Intelligence

- Cluster similar events into one incident/opportunity group.
- Add AI scoring for priority, confidence, business value, and suggested action.
- Add subscription simulation against historical events.
- Add automation budget per Agent and per category.
- Add event analytics: noise rate, task conversion rate, consumer success rate, time to consume.

---

## Explicit Non-Goals For Phase 1

- No distributed message queue.
- No full webhook marketplace.
- No unrestricted Agent-created categories.
- No automatic high-risk code changes from arbitrary events.
- No replacement of TaskBoard, Session history, or Team mailbox.
