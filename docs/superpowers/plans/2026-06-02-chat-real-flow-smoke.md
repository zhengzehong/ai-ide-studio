# Chat Real Flow Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 真实启动当前开发环境，完整测试对话主流程，发现并修复会话切换、消息状态、模型/模式切换、滚动与样式问题。

**Architecture:** 先使用独立 DATA_DIR/LOG_DIR 启动后端与 Vite 前端，优先用 mock/dev Agent 做稳定闭环测试；若发现问题，按“复现证据 -> 自动化测试 -> 最小修复 -> 浏览器复验”的顺序处理，避免回滚已有事件流/历史性能优化。

**Tech Stack:** Hono + SQLite 后端，React + Zustand 前端，Vitest 测试，Playwright/Browser 真实 UI 验证。

---

### Task 1: 启动隔离环境并记录基线

**Files:**
- No code changes expected.

- [ ] 清理并创建隔离运行目录：`$env:TEMP\ai-ide-studio-chat-real-data`、`$env:TEMP\ai-ide-studio-chat-real-logs`。
- [ ] 启动后端：`HOST=127.0.0.1 PORT=18800 DATA_DIR=<temp> LOG_DIR=<temp> node --import tsx src/entry.ts`。
- [ ] 启动前端：`npm run dev:ui -- --host 127.0.0.1`。
- [ ] 浏览器打开 `http://127.0.0.1:5173/workspace`，记录初始截图与 console/network 错误。

### Task 2: 真实测试对话流程

**Files:**
- No code changes expected unless a bug is found.

- [ ] 准备一个可用项目和 mock/dev Agent，会话必须归属当前项目。
- [ ] 创建会话 A，发送简单消息，确认：用户消息立即出现；Agent 准备/连接/加载状态立即出现；完成后回复不消失。
- [ ] 创建会话 B，确认不会显示会话 A 的历史消息。
- [ ] 在会话 B 发送较长消息，确认：流式/加载状态可见；完成后内容稳定；自动滚动到最新内容。
- [ ] 在 A/B 之间来回切换，确认只显示当前会话消息，历史工具/事件折叠策略不影响最新消息。
- [ ] 打开模型、模式、权限/工具相关入口，确认菜单位置、样式和状态合理，不误报 mock Agent 不支持的真实能力。

### Task 3: 若发现 bug，按 TDD 修复

**Files:**
- Modify only the minimal affected files.
- Add/modify tests under `tests/unit/` or `tests/integration/`.

- [ ] 记录复现步骤、截图、console/backend 日志。
- [ ] 写一个失败测试覆盖根因。
- [ ] 运行目标测试确认 RED。
- [ ] 做最小代码修复，不改变既有对话架构。
- [ ] 运行目标测试确认 GREEN。
- [ ] 浏览器重新跑对应步骤确认真实 UI 修复。

### Task 4: 最终验证

**Files:**
- Review all modified files.

- [ ] 运行相关目标测试。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `git diff --check`。
- [ ] 汇报真实测试覆盖、截图路径、发现问题、修复内容、剩余风险。
