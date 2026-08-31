# Workspace Process Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct PC Workspace process disclosure so reasoning opens while streaming and closes at completion, while intermediate notes remain fully visible.

**Architecture:** Keep the existing `thinking` and `note` process block types and existing renderers. Add only a small reusable disclosure-state hook so Workspace, conversation pane, streaming, and history paths share the same state transition without introducing new display components.

**Tech Stack:** React 19, TypeScript, Vitest, React DOM server/test utilities.

**Spec:** User-confirmed behavior in task `task-8ad278ed`.

## Global Constraints

- Do not add `ProcessThinkingBlock` or `ProcessNoteBlock` display components.
- Do not change the outer execution-process disclosure behavior.
- Do not restart PRD services or touch the online database.

---

### Task 1: Lock Process Disclosure Behavior With Tests

**Files:**
- Create: `tests/unit/process-block-disclosure.test.tsx`
- Modify: `ui/src/components/chat/process-detail.ts`

**Interfaces:**
- Consumes: existing `ConversationProcessBlockProps.isStreaming`.
- Produces: `useProcessThinkingDisclosure(isStreaming: boolean)` returning `{ open, toggle }`.

- [x] Write SSR tests proving completed thinking hides its body, streaming thinking shows its body, and notes show full Markdown without an inner button.
- [x] Run the focused test and verify it fails because the current renderer always shows thinking and renders notes as plain text.
- [x] Add transition coverage proving `true -> false` closes reasoning and user overrides behave predictably.

### Task 2: Apply Behavior To Existing Renderers

**Files:**
- Modify: `ui/src/components/chat/ConversationProcessBlock.tsx`
- Modify: `ui/src/components/chat/ConversationMessageList.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/chat/conversation-pane.css`

**Interfaces:**
- Consumes: `useProcessThinkingDisclosure(isStreaming)`.
- Produces: consistent existing `thinking` and `note` rendering across Workspace, conversation pane, streaming, and history.

- [x] Use the helper in existing thinking branches and pass the real streaming state.
- [x] Simplify the existing Workspace note renderer to a static title plus full Markdown body.
- [x] Route historical conversation thinking through the existing `ConversationProcessBlock`.
- [x] Run focused tests and adjust only styles required by the confirmed interaction.

### Task 3: Verify, Review, And Integrate

**Files:**
- Modify: this plan checklist only as implementation evidence requires.

- [x] Run targeted tests, TypeScript checks, lint, production build, full tests, and `git diff --check`.
- [ ] Commit the feature branch and request independent review against the base commit.
- [ ] Resolve all P0/P1/P2 findings, re-verify, and merge into `prd` with `--no-ff`.
