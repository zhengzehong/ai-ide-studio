# Timeline Summary Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session timeline summaries describe the handled object, actual work, and final result instead of restating user requests.

**Architecture:** Keep the change inside `src/core/timeline.ts`: preserve the existing OpenAI-compatible chat call, improve the turn payload sent to the timeline model, and tighten the prompt with examples and anti-examples. Extend the existing timeline unit test to assert the prompt receives complete plain-text inputs and outcome-bearing agent output.

**Tech Stack:** TypeScript, Vitest, SQLite test store, existing timeline model refinement flow.

---

### Task 1: Add Failing Prompt Coverage

**Files:**
- Modify: `tests/unit/timeline.test.ts`

- [x] Add a unit test that generates historical timeline from one long user message and one long agent final output.
- [x] Stub `fetch` and capture the chat completion request body.
- [x] Assert the prompt includes the full text user input, includes the final outcome from the tail of the agent output, contains positive examples, and contains anti-examples.
- [x] Run: `npm test -- tests/unit/timeline.test.ts`
- [x] Expected before implementation: the new test fails because current code slices `user_input` to 150 chars, `agent_output` to 200 chars, and lacks examples.

### Task 2: Implement Turn Text Preparation

**Files:**
- Modify: `src/core/timeline.ts`

- [x] Replace fixed 150/200 character slicing with helper functions that keep full plain text user input and preserve useful agent output.
- [x] For agent output under the configured threshold, pass it as a single full string.
- [x] For longer agent output, pass beginning, middle, and end sections so the final result is retained.
- [x] Avoid tool-call payloads, image/file/base64-like blobs, and binary-looking text in the prompt payload.

### Task 3: Tighten Prompt Instructions

**Files:**
- Modify: `src/core/timeline.ts`

- [x] Update the prompt so each item must identify processing object, actual action, and final result.
- [x] Tell the model to prioritize `agent_output` and use `user_input` only for context.
- [x] Add two good examples and several bad vague examples.
- [x] Keep JSON output contract unchanged.

### Task 4: Verify And Review

**Files:**
- Test: `tests/unit/timeline.test.ts`
- Test: full project commands

- [x] Run: `npm test -- tests/unit/timeline.test.ts`
- [x] Run: `npm test`
- [x] Run: `npm run build`
- [x] Run: `npm run lint`
- [x] Run: `git diff --check`
- [x] Review the diff for scope creep, accidental frontend changes, and token leakage.
