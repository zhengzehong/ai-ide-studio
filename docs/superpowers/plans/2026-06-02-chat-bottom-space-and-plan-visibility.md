# Chat Bottom Space And Plan Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce excessive bottom whitespace in chat history and hide the plan panel after the assistant stops executing.

**Architecture:** Keep chat message rendering unchanged. Tune the virtual list bottom spacer and add a small pure helper for plan-panel visibility.

**Tech Stack:** React, TypeScript, Vitest.

---

### Task 1: Bottom Space And Plan Visibility

**Files:**
- Modify: `ui/src/components/chat/VirtualChatList.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/virtual-chat-window.test.ts`
- Test: `tests/unit/plan-visibility.test.ts`

- [ ] Add tests for virtual list default bottom spacer and plan-panel visibility.
- [ ] Reduce default virtual-list bottom padding.
- [ ] Reduce message-list container bottom padding.
- [ ] Show the plan panel only while the assistant is actively working or waiting for interaction.
- [ ] Run targeted tests and project checks.
