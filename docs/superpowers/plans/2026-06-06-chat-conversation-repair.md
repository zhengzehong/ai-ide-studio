# Chat Conversation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 PRD 对话页出现的重复回复、执行过程详情打不开、权限/AI 提问/计划块显示不完整、工具标题被泛化覆盖、运行状态误导等问题，同时保持现有对话设计：最新轮次流式展示执行过程，完成后默认折叠，历史执行过程懒加载。

**Architecture:** 后端继续以 `messages` 作为历史最终消息来源，`turn_process_items` 作为执行过程来源，`session_events` 只做恢复/兜底；前端消息合并采用同 ID upsert，执行过程摘要先加载、详情按需加载；UI 只做最小状态与块渲染补齐，不回退到旧 event timeline 主渲染。

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, Hono/ws, better-sqlite3.

---

### Task 1: 修复最终消息重复追加

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Test: `tests/unit/message-merge.test.ts`

- [x] **Step 1: 写失败测试**
  - 覆盖同一个 agent message id 的 running/streaming 本地消息收到 completed final message 后应替换，而不是追加带后缀的新消息。
  - 覆盖替换时保留已有 `processBlocks` / `finalAnswer` / `decision_json`，避免刚完成轮次的执行过程和统计消失。

- [x] **Step 2: 运行目标测试确认失败**
  - Run: `npm test -- tests/unit/message-merge.test.ts`
  - Expected: 新测试失败，旧的“ACP reuses message id appends”测试需要改为新行为。

- [x] **Step 3: 最小实现**
  - `appendFinalizedMessage()` 如果存在相同 id，使用 `keepExistingFullToolCalls()` 合并并原位替换；不存在才 append。

- [x] **Step 4: 运行目标测试确认通过**
  - Run: `npm test -- tests/unit/message-merge.test.ts`

### Task 2: 执行过程详情按需加载

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/turn-blocks.ts`
- Modify: `ui/src/components/chat/TurnContentView.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/session-message-process.test.ts`

- [x] **Step 1: 写失败测试**
  - 覆盖 `fetchProcessItemDetail(sessionId, messageId, itemId)` 调用 `sessions.processItemDetail` 后把 `detail_json` 合并回对应 message 的 `processBlocks`。

- [x] **Step 2: 运行目标测试确认失败**
  - Run: `npm test -- tests/unit/session-message-process.test.ts`

- [x] **Step 3: 最小实现**
  - store 新增详情 loading/error/cache 与 `fetchProcessItemDetail()`。
  - `ToolCallPanel` 展开工具时触发详情加载，只加载该 process item。

- [x] **Step 4: 运行目标测试确认通过**
  - Run: `npm test -- tests/unit/session-message-process.test.ts`

### Task 3: 补齐 permission / elicitation / plan 块显示

**Files:**
- Modify: `ui/src/stores/turn-blocks.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/turn-blocks.test.ts`

- [x] **Step 1: 写失败测试**
  - permission item 应渲染成 `permission` block。
  - elicitation item 应渲染成 `elicitation` block。
  - plan item 应从 detail/content 中恢复计划。

- [x] **Step 2: 运行目标测试确认失败**
  - Run: `npm test -- tests/unit/turn-blocks.test.ts`

- [x] **Step 3: 最小实现**
  - 扩展 `TurnProcessBlockKind`，解析 `permissionRequest` / `elicitationRequest`，UI 显示“权限请求”“AI 提问”“计划”。

- [x] **Step 4: 运行目标测试确认通过**
  - Run: `npm test -- tests/unit/turn-blocks.test.ts`

### Task 4: 保留真实工具标题

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/stores/turn-blocks.ts`
- Modify: `ui/src/stores/streaming-buffer.ts`
- Modify: `src/core/tool-calls.ts`
- Modify: `src/acp/update-mapper.ts`
- Test: `tests/unit/message-merge.test.ts`
- Test: `tests/unit/turn-blocks.test.ts`

- [x] **Step 1: 写失败测试**
  - 已有真实标题 `filesystem.read_text_file xxx` 时，后续 `工具调用 #abc` / mojibake / `Tool call` 更新不得覆盖。

- [x] **Step 2: 运行目标测试确认失败**
  - Run: `npm test -- tests/unit/message-merge.test.ts tests/unit/turn-blocks.test.ts`

- [x] **Step 3: 最小实现**
  - 统一 generic title 判断：`工具调用`、`工具调用 #...`、`宸ュ叿璋冪敤`、`宸ュ叿璋冪敤 #...`、`Tool call`。
  - merge 时只有 incoming 标题有意义，或 existing 标题无意义时才覆盖。

- [x] **Step 4: 运行目标测试确认通过**
  - Run: `npm test -- tests/unit/message-merge.test.ts tests/unit/turn-blocks.test.ts`

### Task 5: 对话运行状态最小修复

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`

- [x] **Step 1: 定位当前状态文案来源**
  - 确认 header/sidebar 是否把 agent runtime `running` 当成“正在生成”。

- [x] **Step 2: 最小实现**
  - 当前会话“正在生成/转圈”只依据 `runningSessionIds[currentSessionId]`、streaming message、pending permission/elicitation。
  - agent runtime `running` 在非生成场景显示为“已连接/待机”，不显示为会话正在跑。

- [x] **Step 3: 浏览器手工验证**
  - 打开本地/PRD workspace，切换已完成会话不应显示正在生成；新 prompt 发送后立即有反馈。

### Task 6: 全量验证、提交、更新 PRD

**Files:**
- Commit changed tracked files only; do not commit unrelated `chat-audit-*.md`.

- [x] **Step 1: 全量验证**
  - Run: `npm test`
  - Run: `npm run lint`
  - Run: `npm run build`
  - Run: `git diff --check`

- [x] **Step 2: 提交 master**
  - Commit message: `fix: repair chat process rendering`

- [x] **Step 3: 更新 PRD 分支**
  - In `D:\code_space\python_space\ai-ide-studio-prd`: merge latest `master` into `prd`，保留 PRD 端口/数据目录配置。
  - Run: `./scripts/start-prd-local.ps1`（实际路径 `./scripts/start-prd-local.ps1`）重启 PRD。

- [x] **Step 4: PRD 验证**
  - Browser open `http://localhost:18900/workspace`。
  - 验证：最新回复不重复、执行过程可展开、工具详情可按需展开、完成后执行过程默认折叠、切换会话不串消息。
