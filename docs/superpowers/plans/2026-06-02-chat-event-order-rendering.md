# Chat Event Order Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render chat content from session events when available so text and tool calls stay in chronological order.

**Architecture:** Keep the existing message-based lazy tool fallback for sessions without events. Add a small pure render-item builder that prefers grouped event timeline blocks, then wire `Workspace` to it.

**Tech Stack:** React, TypeScript, Zustand, Vitest.

---

### Task 1: Event-First Render Items

**Files:**
- Create: `ui/src/components/chat/render-items.ts`
- Test: `tests/unit/chat-render-items.test.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [ ] Add a failing unit test proving event text/tool/text order is preserved.
- [ ] Implement a pure `buildChatRenderItems` helper that uses `buildChatTimelineFromEvents` and `groupChatTimelineItems` when events exist.
- [ ] Keep message rendering as the fallback when events are missing.
- [ ] Use the helper from `Workspace.tsx`.
- [ ] Run targeted tests and project checks.
