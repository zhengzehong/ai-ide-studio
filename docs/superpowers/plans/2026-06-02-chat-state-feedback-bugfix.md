# Chat State Feedback Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当前对话页的会话串消息、发送后缺少即时反馈、失败无可见回复、完成后回复消失问题，同时保留最新回复按事件顺序渲染文本/工具/文本块的能力。

**Architecture:** 只修对话状态边界和渲染合并逻辑：服务端消息按 session 隔离合并；前端渲染把事件时间线作为优先表示，但补上未被时间线覆盖的消息与流式占位；后端在 prompt 失败且没有任何 agent 内容时落库一条可见错误消息。

**Tech Stack:** React + Zustand 前端状态，Vitest 单元/集成测试，Hono/SQLite 后端会话存储。

---

### Task 1: 会话消息合并隔离

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/stores/session.store.ts`
- Test: `tests/unit/message-merge.test.ts`

- [ ] 写失败测试：服务端返回新 session 空历史时，不保留旧 session 消息；同 session 的本地临时消息仍保留。
- [ ] 运行目标测试确认 RED：`npm test -- tests/unit/message-merge.test.ts`
- [ ] 新增 `mergeMessagesForSession(serverMessages, currentMessages, sessionId)`，只保留同 session 的当前消息参与合并。
- [ ] `fetchMessages(sessionId)` 改用该 helper，避免 `[] + old state.messages` 串会话。
- [ ] 运行目标测试确认 GREEN。

### Task 2: 时间线渲染补齐未覆盖消息与流式反馈

**Files:**
- Modify: `ui/src/components/chat/render-items.ts`
- Test: `tests/unit/chat-render-items.test.ts`

- [ ] 写失败测试：已有 `message.user` 时间线时，仍显示未被时间线覆盖的流式 agent bubble。
- [ ] 写失败测试：已有 user 时间线但最终 agent 消息只存在于 messages 时，最终消息不能消失。
- [ ] 运行目标测试确认 RED：`npm test -- tests/unit/chat-render-items.test.ts`
- [ ] 渲染合并逻辑按时间排序 timeline group 与未覆盖 messages；若 streamingBubble 未被 timeline 覆盖则追加。
- [ ] 运行目标测试确认 GREEN。

### Task 3: prompt 失败时产生可见 agent 错误消息

**Files:**
- Modify: `src/core/sessions.ts`
- Test: `tests/integration/session-done-error.test.ts`

- [ ] 写失败测试：ACP prompt 在没有任何 agent 输出前失败时，`messages` 表有一条 agent 错误消息。
- [ ] 运行目标测试确认 RED：`npm test -- tests/integration/session-done-error.test.ts`
- [ ] `session:done` 落库 pending message 时增加 error fallback，只有 pending 为空且 stopReason 为 error 时写入 `执行失败：...`。
- [ ] 运行目标测试确认 GREEN。

### Task 4: 回归验证与审查

**Files:**
- No production files beyond Tasks 1-3.

- [ ] 运行目标测试：`npm test -- tests/unit/message-merge.test.ts tests/unit/chat-render-items.test.ts tests/integration/session-done-error.test.ts`
- [ ] 运行全量测试：`npm test`
- [ ] 运行构建：`npm run build`
- [ ] 运行 lint：`npm run lint`
- [ ] 运行空白检查：`git diff --check`
- [ ] 审查 `git diff`，确认没有动 PRD worktree 和 `.claude/settings.local.json` 以外的无关改动。
