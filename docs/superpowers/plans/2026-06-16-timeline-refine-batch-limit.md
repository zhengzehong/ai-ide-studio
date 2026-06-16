# Timeline Refine Batch Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent long session timelines from getting stuck when many raw timeline entries are refined at once.

**Architecture:** Keep timeline refinement in `src/core/timeline.ts`, but cap each model call to the oldest 10 raw rows and raise the chat completion output budget to 20000 tokens. Existing historical generation already loops over refinement calls, so the batch cap naturally drains large backlogs in multiple calls.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing timeline store.

---

### Task 1: Add Regression Coverage

**Files:**
- Modify: `tests/unit/timeline.test.ts`

- [ ] **Step 1: Add a test for batched raw refinement and model token budget**

Add a unit test that creates 12 historical turns, captures the prompt body for each fetch call, and asserts each call uses `max_tokens: 20000` while no call contains more than 10 new turns.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/unit/timeline.test.ts`

Expected before implementation: the new test fails because the first request includes all 12 raw turns and `max_tokens` is still 800.

### Task 2: Limit Raw Batch Size

**Files:**
- Modify: `src/core/timeline.ts`

- [ ] **Step 1: Add constants**

Add constants near the existing timeline limits:

```ts
const TIMELINE_REFINE_MAX_RAW_BATCH = 10
const TIMELINE_MODEL_MAX_TOKENS = 20000
```

- [ ] **Step 2: Use the token constant**

Change `callOpenAIModel()` so the request body uses `max_tokens: TIMELINE_MODEL_MAX_TOKENS`.

- [ ] **Step 3: Process only the oldest 10 raw rows**

Change `runModelRefine()` to slice `timelineStore.listRaw(sessionId)` into a batch:

```ts
const allRaw = timelineStore.listRaw(sessionId)
const rawBatch = allRaw.slice(0, TIMELINE_REFINE_MAX_RAW_BATCH)
```

Use `rawBatch` for `collectNewTurns()`, `inputIds`, and `applyModelOutput()`. Keep `allRaw.length` in logs and add `batchRawCount`.

### Task 3: Verify And Commit

**Files:**
- Modify: `src/core/timeline.ts`
- Modify: `tests/unit/timeline.test.ts`
- Create: `docs/superpowers/plans/2026-06-16-timeline-refine-batch-limit.md`

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/unit/timeline.test.ts`

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

- [ ] **Step 3: Commit and push prd**

Commit only the timeline batch fix files and push `prd`.
