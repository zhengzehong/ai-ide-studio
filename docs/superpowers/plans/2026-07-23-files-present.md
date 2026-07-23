# Files Present Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable multi-file deliverable tool with switchable Markdown previews on PC and mobile.

**Architecture:** Extend the existing message presentation union with metadata-only file manifests. Reuse realtime tool blocks for immediate cards, `presentations_json` for history, and authenticated `fs.read` for lazy content loading.

**Tech Stack:** TypeScript, Hono/WS RPC, React, Zustand, Vitest.

---

### Task 1: Tool And Presentation Persistence

**Files:**
- Create: `src/tools/handlers/files-present.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/seed.ts`
- Modify: `src/core/filesystem.ts`
- Modify: `src/core/message-presentations.ts`
- Modify: `src/core/ai-ide-system-prompt.ts`
- Test: `tests/unit/files-present.test.ts`
- Test: `tests/unit/message-presentations.test.ts`
- Test: `tests/unit/tool-seed.test.ts`

- [x] Write failing tests for path validation, 1-20 unique files, manifest output, persistence extraction, and tool seed registration.
- [x] Run targeted tests and confirm the missing tool behavior fails.
- [x] Add safe file metadata inspection, handler registration/seed, presentation parsing, and system prompt instruction.
- [x] Run targeted backend tests and commit.

### Task 2: PC Card And Multi-file Modal

**Files:**
- Create: `ui/src/components/chat/FilesPresentationCard.tsx`
- Create: `ui/src/components/file-viewer/PresentedFilesModal.tsx`
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/components/chat/TurnContentView.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/files-presentation-pc.test.ts`

- [x] Write failing tests for history normalization, realtime/history deduplication, file switching, and rendered Markdown.
- [x] Run targeted PC tests and confirm failure.
- [x] Add the card, modal, lazy `fs.read`, Markdown rendering, and Workspace state wiring.
- [x] Run targeted PC tests and commit.

### Task 3: Mobile Card And Full-screen Viewer

**Files:**
- Create: `mobile/src/components/chat/FilesPresentationCard.tsx`
- Create: `mobile/src/components/file-viewer/PresentedFilesOverlay.tsx`
- Modify: `mobile/src/components/chat/TurnContent.tsx`
- Modify: `mobile/src/pages/ChatPage.tsx`
- Test: `tests/unit/files-presentation-mobile.test.ts`

- [x] Write failing tests for history card rendering and switching among multiple files.
- [x] Run targeted mobile tests and confirm failure.
- [x] Add the card, full-screen viewer, horizontal selector, and existing FileDetail reuse.
- [x] Run targeted mobile tests and commit.

### Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mcp-tool-platform.md`

- [x] Document the tool contract and message presentation behavior.
- [x] Run targeted tests, `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
- [x] Request independent review and merge only after approval.
