# Session Input And Event Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste or drag images into the session input and render assistant output in chronological event order instead of merging all reply text at the end.

**Architecture:** Reuse the existing image attachment payload and extract file-to-image conversion into a small UI helper. Use persisted `session_events.sequence` as the display source for agent turns, deriving ordered chat timeline items from event chunks while keeping stored `messages` as a compatibility fallback.

**Tech Stack:** React 19, TypeScript 6, Zustand, Vitest.

---

### Task 1: Add Ordered Event Timeline Derivation

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Test: `tests/unit/session-event-timeline.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that build `SessionEventData[]` with `message.user`, `message.chunk`, `tool.call`, `tool.update`, `message.chunk`, and `message.done` events. Assert that the derived display list keeps the order: user message, first agent text segment, tool call, second agent text segment.

- [ ] **Step 2: Run the focused test**

Run: `npm test -- tests/unit/session-event-timeline.test.ts`
Expected before implementation: fail because the new derivation function is missing.

- [ ] **Step 3: Implement the reducer**

Add exported timeline item types and a `buildChatTimelineFromEvents(events)` function. The function sorts by `sequence`, flushes pending text before tool calls, updates existing tool cards for `tool.update`, and attaches turn usage from `message.done` to the last agent item for the turn.

- [ ] **Step 4: Verify the focused test passes**

Run: `npm test -- tests/unit/session-event-timeline.test.ts`
Expected: pass.

### Task 2: Render Timeline Items In Workspace

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/stores/session.store.ts` if store shape needs exposing derived timeline data
- Test: extend `tests/unit/session-event-timeline.test.ts` only if additional pure behavior is needed

- [ ] **Step 1: Wire Workspace to ordered items**

Derive display items from `events` and current `streamingMessage`. Use event items when they exist for the selected session; otherwise fall back to existing `messages`.

- [ ] **Step 2: Keep existing bubble rendering style**

Adapt `ChatBubble` to accept timeline items without changing visual styling more than necessary. Tool cards and text segments should render as separate chronological agent bubbles.

- [ ] **Step 3: Verify typecheck/build catches no UI errors**

Run: `npm run build`
Expected: TypeScript and UI build succeed.

### Task 3: Add Paste And Drag Image Input

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`
- Test: compile/build verification

- [ ] **Step 1: Extract image file ingestion**

Create `addImageFiles(files: File[])` in `Workspace.tsx`. It filters non-image files, reads image files as data URLs, stores base64 data and preview URL, and ignores empty input.

- [ ] **Step 2: Reuse ingestion from upload, paste, and drop**

Update `handleImageUpload`; add textarea `onPaste`; add input-card `onDragOver`, `onDragLeave`, and `onDrop`. Dropping or pasting images should show the same preview chips as upload.

- [ ] **Step 3: Allow image-only sends**

Adjust `handleSend` and the send button disabled state so a user can send either text, images, or both. The prompt content may be an empty string when only images are sent.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: success.

### Task 4: Final Verification

**Files:**
- No new files unless tests require it

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/unit/session-event-timeline.test.ts tests/unit/session-event-reducer.test.ts tests/unit/session-finalize.test.ts`
Expected: pass.

- [ ] **Step 2: Run required project checks**

Run: `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
Expected: all pass or any pre-existing failures are reported with exact output.
