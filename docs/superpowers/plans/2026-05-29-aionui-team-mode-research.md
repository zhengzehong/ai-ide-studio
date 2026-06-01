# AionUi Team Mode Research Plan

> **For agentic workers:** This is a research-only task list. Do not implement product changes from this plan.

**Goal:** Clone or otherwise materialize AionUi source under `references/projects/`, then produce a source-backed report on its Team/Multi-Agent architecture and how AI IDE Studio should adapt the idea.

**Architecture:** Keep third-party source under `references/projects/<project-name>` so future reference projects can live next to it. Keep the final analysis under `docs/research/` and separate verified source facts from recommendations.

**Tech Stack:** Local filesystem, Git/GitHub source snapshot, TypeScript/React/Electron source analysis.

---

- [x] Inspect existing `references/` layout and remove misleading temporary leftovers if tools permit.
- [x] Download or clone AionUi source into `references/projects/AionUi-source` with source metadata.
- [x] Identify Team/Multi-Agent source files: data types, DB schema/migrations, IPC/API bridge, renderer pages/hooks/components, MCP/team server tests.
- [x] Trace the end-to-end Team flow: create team, ensure sessions, leader-to-teammate tool calls, event propagation, UI tab/chat rendering, permission badges.
- [x] Write `docs/research/aionui-team-mode-analysis.md` with source path evidence, communication diagrams, tool inventory, and AI IDE Studio implementation recommendations.
- [x] Report any clone/download limitations explicitly if the sandbox cannot create a full Git checkout.

## 结果

- 完整 Git clone 受当前沙箱权限限制失败：Git 创建 worktree / `.git` 报 `Permission denied`。
- 已通过 GitHub API/raw URL 获取源码树和关键源码内容，写入 `references/projects/AionUi-source/`。
- 最终报告：`docs/research/aionui-team-mode-analysis.md`。
