# Chat Long-Session Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统性解决长会话卡顿、流式消息延迟、历史工具调用加载过重、滚动不及时的问题，让 PRD 这类 2 万+ event、数 MB tool JSON 的会话仍能顺畅切换、阅读和继续对话。

**Architecture:** 将聊天性能拆成五条主线：事件流去重、消息渲染缓存、工具数据瘦身、聊天列表虚拟滚动、流式更新节流。历史消息默认走轻量 DTO，不加载完整 `tool_calls_json`；历史工具调用通过摘要列表和单条详情 RPC 懒加载；当前流式回合只由 `session:update` 驱动可见状态，`session:event` 只负责持久化同步/断线恢复，不再每条事件全量 sort/reduce；前端对稳定历史消息 memo 化，必要时虚拟化列表，只渲染可视区域。

**Tech Stack:** Hono/ws RPC + better-sqlite3 + React 19 + Zustand + Vitest。

---

## Current Behavior Summary

- 切换会话时，`selectSession()` 会清空当前会话状态，订阅新 session，然后并行调用：
  - `sessions.messages`：后端 `messageStore.list()` 默认返回最近 100 条 message。
  - `sessions.events`：前端传 `limit: 1000`，后端返回最近 1000 条 event。
  - `session.getModels`。
- 所以现在不是读取数据库所有历史，但会读取“最近 100 条消息 + 最近 1000 条事件”。
- 性能问题在于：最近 100 条 message 里每条都带完整 `tool_calls_json`；长会话里单条可达数 MB。前端 render 阶段还会 `JSON.parse(tool_calls_json)` 并创建工具调用组件。
- `session:update` 和 `session:event` 都会影响实时 UI。当前 `session:event` 到达时会复制 events、按 sequence 排序、全量 `reduceSessionEvents(events)`，然后保存 cache；长流式会话中这会造成明显主线程压力。
- `Workspace.tsx` 当前直接渲染全部消息/分组，没有虚拟滚动；长会话里 DOM 节点和工具按钮数量会持续增长。
- 流式输出时每个 chunk/tool update 都可能触发 Zustand setState、Markdown 解析、工具卡片 render、scroll 计算和 layout。

---

## Coverage Of The Five Optimization Points

1. **事件流处理**：Task 1 明确处理。目标是 `session:update` 驱动实时可见状态，`session:event` 只做同步/恢复，不再每条全量 reduce。
2. **消息渲染 memo + 预解析**：Task 2 明确处理。历史消息在 store 层归一化/预解析，`ChatBubble`/`MarkdownRenderer` memo 化，render 阶段不再反复 parse 大 JSON。
3. **工具调用数据瘦身**：Task 3 和 Task 4 明确处理。历史工具默认只加载摘要，详情点击后按需加载并截断。
4. **聊天区虚拟滚动**：Task 5 明确处理。先按消息/气泡分组粒度虚拟化，避免一次渲染全部历史 DOM。
5. **流式更新节流**：Task 6 明确处理。content/tool delta 批量 flush，滚动只在必要时触发。

---

## Design Decisions

1. **实时和历史分离。** 当前正在输出的一轮用 `session:update` 增量显示；历史显示优先用 `messages`，不要用 event timeline 全量重建完整历史。
2. **`session:event` 不再驱动每条实时重渲染。** 它可以进入一个轻量 event cursor/cache，用于断线恢复、刷新后恢复未完成尾巴、权限/计划等状态补偿。
3. **历史消息默认轻量加载。** `sessions.messages` 默认不返回完整 `tool_calls_json`，只返回 `has_tool_calls` 和 `tool_call_count`。
4. **历史工具调用两级懒加载。**
   - 第一级：点击“本轮有 N 个工具调用”后请求工具摘要列表。
   - 第二级：点击某个工具后请求单个工具详情，详情做输出截断。
5. **实时工具调用继续实时显示。** 当前正在跑的工具调用不能完全懒加载，否则会影响可观测性。
6. **虚拟滚动放在工具瘦身之后。** 先把单条消息变轻，再做虚拟列表，否则虚拟列表内部仍可能持有 MB 级 JSON。
7. **先不做大 schema 迁移。** 工具详情先从现有 `messages.tool_calls_json` 解析，减少迁移风险；如果后续数据继续膨胀，再单独设计 `message_tool_calls` 归一化表。

---

## Task 1: Event Stream Processing Without Duplicate Real-Time Rendering

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/session-events.ts`
- Modify: `tests/unit/session-event-reducer.test.ts`
- Add: `tests/unit/session-store-event-flow.test.ts`

- [ ] Define the active-session state split in `session.store.ts`:
  - `messages`: stable historical messages from `sessions.messages`.
  - `streamingMessage`: visible current turn from `session:update`.
  - `events`: small recovery window, not the main render source for every chunk.
  - `lastEventSequenceBySession`: cursor for `session:event` recovery.

- [ ] Change `fetchEvents(sessionId)` behavior:
  - Keep `limit: 1000` only for recovery of interrupted/current tail.
  - Do not use fetched events to rebuild already completed historical messages when `messages` already contain those turns.
  - Only apply `reduceSessionEvents(events)` for incomplete tail state, capabilities, permissions, plan, and turn usage recovery.

- [ ] Change `session:event` listener:
  - Append/update the event cursor.
  - Do not call `sort + reduceSessionEvents(allEvents)` for every event when a matching `session:update` already updated visible streaming state.
  - For events not mirrored by `session:update` or needed for state recovery (`permission.request`, `elicitation.request`, `plan.update`, `usage.update`, `message.done`), update the specific small state directly.

- [ ] Add an incremental event reducer helper in `session-events.ts`:
  - Input: current reduced state + one event.
  - Output: next reduced state.
  - Reuse existing event parsing/merge logic to avoid behavior drift.

- [ ] Keep `session:done` finalization deterministic:
  - Use `streamingMessage`/`lastStreamingSnapshot` first.
  - Use event recovery only as fallback.
  - Ensure the final message is appended once, not duplicated by both update and event paths.

- [ ] Tests:
  - A `session:update` content chunk followed by equivalent `session:event` must not duplicate visible content.
  - 1,000 synthetic `session:event` chunks should not require calling full-array reduce per event.
  - Permission/elicitation events still show blocking interaction promptly.
  - Interrupted session reload can still recover the unfinished tail from recent events.

---

## Task 2: Message Rendering Memoization And Store-Level Parsing

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/MarkdownRenderer.tsx`
- Test: `tests/unit/message-merge.test.ts`

- [ ] Introduce a UI-normalized message shape in the store:
  - Keep original `MessageData` fields needed by RPC.
  - Add parsed/cached fields only when available: `parsedToolCalls`, `parsedAttachments`, `parsedDecision`.
  - Add lightweight flags: `hasToolCalls`, `toolCallCount`.

- [ ] Normalize messages immediately after `fetchMessages()`:
  - Parse small JSON fields once in store.
  - Do not parse `tool_calls_json` in render when it is absent or intentionally stripped.
  - If full `tool_calls_json` is present for a just-finished local message, parse once and cache as `parsedToolCalls`.

- [ ] Update `ChatBubble` / `ChatBubbleBlockView`:
  - Use normalized fields from store.
  - Remove render-time `JSON.parse(message.tool_calls_json)` except a compatibility fallback behind a helper.

- [ ] Memoize expensive components:
  - `MarkdownRenderer` should be wrapped with `React.memo`.
  - Historical `ChatBubble` should be wrapped with `React.memo` and receive stable props.
  - `ToolCallPanel` should be wrapped with `React.memo` where safe.

- [ ] Keep streaming bubble mutable but bounded:
  - Streaming bubble may re-render as deltas arrive.
  - Historical bubbles should not re-render on every streaming chunk unless their props changed.

- [ ] Tests:
  - Merging server messages with local finalized message keeps one message.
  - Normalizing a message with attachments parses attachments once.
  - A historical message without `tool_calls_json` still reports `hasToolCalls` and `toolCallCount`.

---

## Task 3: Backend Lightweight Message DTO And Lazy Tool RPC

**Files:**
- Modify: `src/types/ws-protocol.ts`
- Modify: `src/store/sessions.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Add: `src/store/tool-call-history.ts`
- Test: `tests/unit/tool-call-history-summary.test.ts`
- Test: `tests/integration/session-history-lightweight.test.ts`

- [ ] Add protocol types:
  - `ToolCallSummaryData`: `id`, `title`, `kind`, `status`, `hasRawInput`, `hasRawOutput`, `hasTerminalOutput`, `outputPreview`, `error`.
  - `ToolCallDetailData`: selected tool detail with `rawInputPreview`, `rawOutputPreview`, `terminalOutputTail`, `contentPreview`, `progressTail`, and `truncated` flags.
  - Extend message response with `has_tool_calls?: boolean` and `tool_call_count?: number`.

- [ ] Add `src/store/tool-call-history.ts` helper:
  - `summarizeToolCalls(toolCalls: unknown[]): ToolCallSummaryData[]`.
  - `selectToolCallDetail(toolCalls: unknown[], toolCallId: string): ToolCallDetailData | undefined`.
  - `previewValue(value, limit)` to stringify safely and truncate.

- [ ] Change `sessions.messages` to accept `includeToolCalls?: boolean`:
  - Default `false`.
  - When false, strip `tool_calls_json` before sending to client.
  - Set `has_tool_calls` from `tool_calls_json != null`.
  - Compute `tool_call_count` by parsing only returned rows; if parse fails, keep `has_tool_calls: true` and omit count.

- [ ] Add RPC `sessions.messageToolCalls`:
  - Input: `sessionId`, `messageId`.
  - Output: `ToolCallSummaryData[]`.
  - Validate message belongs to session.
  - Parse `tool_calls_json` server-side and return summaries only.

- [ ] Add RPC `sessions.messageToolCallDetail`:
  - Input: `sessionId`, `messageId`, `toolCallId`.
  - Output: `ToolCallDetailData`.
  - Validate message belongs to session.
  - Return one tool only.
  - Cap preview strings, e.g. raw input/output 20 KB, terminal output tail 20 KB, with `truncated` flags.

- [ ] Tests:
  - Summary does not include full `rawOutput`.
  - Detail returns only selected tool.
  - Large output is truncated and flagged.
  - `sessions.messages` default response has no full `tool_calls_json`.
  - `sessions.messages includeToolCalls:true` still returns full field for compatibility.

---

## Task 4: Frontend Lazy Historical Tool Calls UI

**Files:**
- Create: `ui/src/components/chat/LazyToolCallsBlock.tsx`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/lazy-tool-calls-state.test.ts`

- [ ] Add lazy tool state to session store:
  - `toolCallSummariesByMessageId`.
  - `toolCallDetailsByKey` where key is `${messageId}:${toolCallId}`.
  - `toolCallLoadingByKey` and `toolCallErrorByKey`.

- [ ] Add store actions:
  - `fetchMessageToolCalls(sessionId, messageId)`.
  - `fetchMessageToolCallDetail(sessionId, messageId, toolCallId)`.
  - Scope cache by session or clear it on session switch.

- [ ] Create `LazyToolCallsBlock`:
  - Collapsed state: `工具调用 · N 个` or `工具调用 · 点击加载`.
  - First expand: request summary list.
  - Render summary rows only: title, kind, status, short preview.
  - Click summary row: request and show single tool detail.
  - Reuse current visual style: border, small status chip, blue/green/red tokens.

- [ ] Update `ChatBubbleBlockView`:
  - Live block with `toolCalls` renders normal `ToolCallPanel`.
  - Historical message with `hasToolCalls` but no parsed/full tool calls renders `LazyToolCallsBlock`.
  - Historical message with parsed full tool calls, such as just-finished local turn, can render normal panels until the session is reloaded.

- [ ] Tests:
  - Historical message with `hasToolCalls` renders lazy block, not individual panels.
  - Expanding loads summaries once.
  - Clicking one summary loads one detail only.

---

## Task 5: Chat List Virtualization

**Files:**
- Create: `ui/src/components/chat/VirtualChatList.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/virtual-chat-window.test.ts`

- [ ] Build a small message/group-level virtual list:
  - Input: ordered render items/groups.
  - Output: only visible items plus overscan.
  - Use estimated height first, then refine with `ResizeObserver`.
  - Preserve total scroll height using top/bottom spacer divs.

- [ ] Virtualize at bubble/group level, not inside Markdown/tool detail:
  - This keeps implementation smaller.
  - Lazy tool details are already capped, so row height is manageable after expansion.

- [ ] Keep bottom-stick behavior:
  - On new messages, if user is near bottom, keep pinned to bottom.
  - If user scrolls up, do not jump.
  - When expanding a historical tool detail, preserve current scroll anchor.

- [ ] Add fallback guard:
  - For very small sessions, render normal list if item count is below a threshold, e.g. 30 groups.
  - For long sessions, use virtual list.

- [ ] Tests:
  - Given 200 items and viewport height, virtual helper returns a bounded visible range.
  - Overscan includes items before/after viewport.
  - Scroll anchor calculation does not produce negative spacer heights.

---

## Task 6: Streaming Update Throttling And Scroll Optimization

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Add: `ui/src/stores/streaming-buffer.ts`
- Test: `tests/unit/streaming-buffer.test.ts`

- [ ] Add streaming buffer helper:
  - Accumulate `contentDelta` strings.
  - Accumulate `thinking` strings.
  - Merge `toolCallUpdate` by tool id.
  - Keep permission/elicitation/config updates outside the buffer so they stay immediate.

- [ ] Flush streaming updates at most once per animation frame or every 50 ms:
  - On each `session:update`, push into buffer.
  - Schedule one flush if not already scheduled.
  - Flush applies one Zustand setState with merged deltas.

- [ ] Replace `streamingScrollSignature` JSON stringify:
  - Use cheap numeric/string fields only: content length, thinking length, tool count, last tool id/status/output length.
  - Avoid mapping/stringifying every tool on every chunk.

- [ ] Only auto-scroll when near bottom:
  - Add helper `isNearBottom(el, thresholdPx = 96)`.
  - If near bottom before render, scroll after flush.
  - If not near bottom, keep user's scroll position.

- [ ] Tests:
  - Ten content deltas flush into one merged content update.
  - Multiple updates for the same tool id merge into one tool update.
  - Permission request bypasses throttle.
  - `isNearBottom` returns expected values.

---

## Task 7: Verification And Performance Checks

**Files:**
- Add/update tests from earlier tasks
- No production code beyond previous tasks

- [ ] Run targeted tests:

```bash
npm test -- tests/unit/session-store-event-flow.test.ts tests/unit/tool-call-history-summary.test.ts tests/unit/streaming-buffer.test.ts
npm test -- tests/integration/session-history-lightweight.test.ts
```

- [ ] Run full verification:

```bash
npm test
npm run build
npm run lint
git diff --check
```

- [ ] Manual browser check on PRD-style long session:
  - Open workspace.
  - Switch to a long session.
  - Verify initial historical load shows collapsed tool sections, not hundreds of tool panels.
  - Expand one message's tool list.
  - Expand one tool detail.
  - Send a new prompt and verify current live tool calls still stream.
  - Switch away/back and confirm it does not refetch full `tool_calls_json`.

- [ ] Measure before/after signals:
  - Network payload for `sessions.messages` should no longer include MB-level `tool_calls_json` by default.
  - DOM button count should drop sharply before any tool section is expanded.
  - `document.querySelectorAll('*').length` should be lower for the same long session.
  - Streaming chunk burst should produce fewer React renders/Zustand updates.
  - Scroll should stay at bottom only when user was already near bottom.

---

## Acceptance Criteria

- `session:update` and `session:event` no longer duplicate realtime rendering work.
- `session:event` does not full sort/reduce all events for every incoming chunk.
- Historical message render path does not parse MB-level `tool_calls_json` during render.
- `MarkdownRenderer`, stable historical bubbles, and tool panels are memoized where safe.
- `sessions.messages` default payload strips full historical `tool_calls_json`.
- Historical tool calls default to a collapsed lazy block.
- Clicking a historical tool block loads summaries only.
- Clicking a single historical tool loads that tool detail only, with output capped.
- Chat list uses virtualization for long sessions.
- Streaming content/tool updates are batched to at most one UI flush per frame/short interval.
- Auto-scroll is reliable at bottom and non-invasive when the user scrolls up.
- Refresh or switching sessions back still shows history and can lazily inspect tool calls.
