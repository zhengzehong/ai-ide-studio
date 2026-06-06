# Chat Process Detail Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复执行过程详情懒加载、会话切换 loading 状态、同 ID 最终消息 stale finalAnswer 三个回归问题。

**Architecture:** 保持现有 `messages + turn_process_items` 设计，不重写对话链路。只在 store 合并/详情加载边界补防御，UI 对 permission/elicitation 复用现有 process item detail RPC。

**Tech Stack:** React 19 + Zustand + Vitest + TypeScript。

---

### Task 1: 修复 same-id finalAnswer stale 合并

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Test: `tests/unit/message-merge.test.ts`

- [ ] 写失败测试：已有消息含 `finalAnswer=旧内容`，服务端返回同 ID `content=新内容` 且无 `finalAnswer` 时，合并结果必须展示新内容。
- [ ] 运行目标测试确认 RED。
- [ ] 修改 `keepExistingFullToolCalls()`：保留 processBlocks，但当 incoming content 与 existing finalAnswer 不一致且 incoming 未带 finalAnswer 时，用 incoming content 刷新 finalAnswer。
- [ ] 运行目标测试确认 GREEN。

### Task 2: 修复 process item detail loading 卡住

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Test: `tests/unit/session-store-process-detail.test.ts`

- [ ] 写失败测试：`fetchProcessItemDetail()` 请求返回前切换会话时，原 key loading 必须清理。
- [ ] 写失败测试：`selectSession(null)` 或切换新会话时，process item loading/error map 必须清空，避免跨会话污染。
- [ ] 运行目标测试确认 RED。
- [ ] 修改 `fetchProcessItemDetail()` mismatch early return 前清 loading；修改 `selectSession`/删除会话清理 process item loading/error。
- [ ] 运行目标测试确认 GREEN。

### Task 3: permission / elicitation 详情可加载

**Files:**
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/turn-blocks.test.ts` 或新增 UI 可测 helper（如必要）

- [ ] 确认 `turnFromProcessItems()` 对 permission/elicitation detail 的映射保留 request/message。
- [ ] 修改 `ProcessBlockView`：permission/elicitation 若 `hasDetail` 且未有 request，显示“加载详情”入口并调用 `onLoadDetail`；loading/error 有明确反馈。
- [ ] 历史执行过程展开后，permission/elicitation 与 tool 一样可按需取回详情。

### Task 4: 验证与同步 PRD

**Files:**
- No code unless verification exposes regression.

- [ ] 运行目标测试。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `git diff --check`。
- [ ] 提交 master。
- [ ] 合并 master 到 `D:\code_space\python_space\ai-ide-studio-prd` 的 `prd` 分支，保留 PRD 端口/数据配置。
- [ ] PRD 运行目标测试与 build，重启 `scripts/start-prd-local.ps1`。
