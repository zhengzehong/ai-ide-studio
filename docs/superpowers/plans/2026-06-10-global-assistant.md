# Global Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one app-wide global assistant that can be selected from Agent Square and opened from a right-side rail as a compact chat drawer.

**Architecture:** Store one fixed global assistant binding in SQLite, backed by an ordinary `agents` row, an ordinary `sessions` row, and a dedicated workspace directory under the data directory. The frontend keeps a separate global assistant chat store so opening the drawer does not change the Workspace page's selected session.

**Tech Stack:** Hono RPC over WebSocket, better-sqlite3 migrations/stores, React 19, Zustand, existing ACP session runtime, existing chat event reducers.

---

### Task 1: Backend Data And RPC

**Files:**
- Create: `src/store/migrations/013-global-assistant.ts`
- Modify: `src/store/migrations/index.ts`
- Create: `src/store/global-assistant.ts`
- Create: `src/gateway/rpc/global-assistant.ts`
- Modify: `src/gateway/rpc/registry.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Test: `tests/integration/global-assistant-rpc.test.ts`

- [x] Write failing integration tests for binding a template as global assistant, returning the fixed session, and resolving the global workspace cwd during ACP session startup.
- [x] Add migration and store for the single `global_assistant` row.
- [x] Add RPC handlers: `globalAssistant.get`, `globalAssistant.setTemplate`, `globalAssistant.touch`.
- [x] Route global assistant sessions to `global_assistant.workspace_dir` in both prompt and session preference paths.
- [x] Run the targeted backend test and confirm it passes.

### Task 2: Frontend State And UI

**Files:**
- Create: `ui/src/stores/global-assistant.store.ts`
- Create: `ui/src/components/global-assistant/GlobalAssistantRail.tsx`
- Create: `ui/src/components/global-assistant/GlobalAssistantDrawer.tsx`
- Modify: `ui/src/components/layout/AppLayout.tsx`
- Modify: `ui/src/components/layout/AppLayout.css`
- Modify: `ui/src/pages/AgentSquare.tsx`

- [x] Add a dedicated global assistant Zustand store with its own session id, message list, streaming turn, plan, permissions, and model/mode/config actions.
- [x] Add right rail and side drawer mounted from `AppLayout`.
- [x] Render a compact chat surface that supports streaming, process blocks, plan bar, permissions, elicitation, stop generation, model/mode/config menus, image paste, and image drop.
- [x] Add "设为全局助理" to Agent Square template cards and show an in-progress state while the binding RPC is running.

### Task 3: Verification And Commit

**Files:**
- All files changed by Task 1 and Task 2 only.

- [x] Run targeted tests for global assistant.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Review `git diff` and commit only related files.
