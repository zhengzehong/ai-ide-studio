# Session Running Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左侧会话列表的“执行中”闪烁状态以可靠的后端真值为准，刷新/重连/切换后仍能恢复，且伪 `session:done` 不再错误清掉真实运行中的状态。

**Architecture:** 后端在 `sessions.list` 返回每个会话的派生 runtime 状态（`activity_state`），来源为内存 active prompt、最新 running agent message、running turn process item、running stage。前端继续使用 `session:activity` 做实时增量，但 `fetchSessions()` 会用 `activity_state` 重新校准 `runningSessionIds`，`session:done` 只在没有后端 running 证据时清理运行态。

**Tech Stack:** TypeScript, Hono/ws, better-sqlite3, React/Zustand, Vitest.

---

### Task 1: 后端会话 runtime 状态

**Files:**
- Modify: `src/store/sessions.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/unit/session-runtime-state.test.ts`

- [x] Step 1: 写失败测试，验证 `sessions.list` 能对最新 running agent message 派生 `activity_state: running`。
- [x] Step 2: 实现 `SessionRuntimeState` / `SessionListRow`，在 store 层提供 `listWithRuntimeState()`。
- [x] Step 3: `sessionManager` 提供 active prompt 查询，RPC `sessions.list` 返回带 `activity_state` 的列表。
- [x] Step 4: 类型补 `activity_state?: 'running' | 'idle'`。
- [x] Step 5: 运行目标测试确认通过。

### Task 2: 前端用后端 runtime 状态校准左侧指示器

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/utils/session-indicators.ts`
- Test: `tests/unit/session-activity-indicators.test.ts`
- Test: `tests/unit/session-store-done-refresh.test.ts`

- [x] Step 1: 写失败测试，验证 `fetchSessions()` 收到 `activity_state: running` 后设置 `runningSessionIds`。
- [x] Step 2: 写失败测试，验证 `session:done` 若当前 session 在 store 内仍有后端 running 证据，不清 running。
- [x] Step 3: 实现 `inferRunningSessions()`，优先使用 `activity_state`，stage 只作为兼容兜底。
- [x] Step 4: `fetchSessions()` 用后端返回重算 running，清理不再 running 的旧内存态。
- [x] Step 5: `session:done` 对当前会话若有 running 持久消息/会话状态，则保留 running 并触发消息刷新。

### Task 3: 验证与同步 PRD

**Files:**
- Verify only unless test/doc updates required.

- [x] Step 1: 运行相关单测。
- [x] Step 2: 运行 `npm test`、`npm run build`、`npm run lint`、`git diff --check`。
- [x] Step 3: 审查 `git diff`，确认只改本任务相关代码。
- [x] Step 4: 提交当前分支 commit。
- [x] Step 5: 合并/同步到 `D:\code_space\python_space\ai-ide-studio-prd`，保持 PRD 端口和数据目录不变。
