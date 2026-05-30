# Desktop Packaging Documentation Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify the desktop packaging architecture document so it is actionable and consistent with the current AI IDE Studio codebase.

**Architecture:** This is a documentation-only change. Keep `docs/architecture/desktop-packaging.md` as a stable architecture document: explain module boundaries, runtime modes, data flow, security, packaging constraints, and implementation notes without turning it into a step-by-step execution plan.

**Tech Stack:** Markdown documentation, Electron target architecture, existing Hono/WS/SQLite/React/Vite backend and frontend architecture.

---

### Task 1: Rewrite desktop packaging architecture

**Files:**
- Modify: `docs/architecture/desktop-packaging.md`

- [ ] Describe the two supported runtime modes: Web mode and Electron mode.
- [ ] Make clear that Electron is a launcher/window shell and business logic stays in the HTTP/WS backend.
- [ ] Add the required backend entrypoint boundary: `startApp()` style app lifecycle, with `entry.ts` only as the CLI/Web launcher.
- [ ] Add production static asset hosting and SPA fallback expectations.
- [ ] Add frontend WebSocket URL derivation rules so Web deployment and Electron random ports both work.
- [ ] Add port, data directory, local access token, and ACP runtime path policies.
- [ ] Align ACP environment variable names with current code (`AI_IDE_CLAUDE_ACP_CMD`, `AI_IDE_CODEX_ACP_CMD`).
- [ ] Keep implementation phases out of the architecture document; use "implementation implications" instead of step-by-step plans.

### Task 2: Self-review

**Files:**
- Read: `docs/architecture/desktop-packaging.md`

- [ ] Confirm the document has no TBD/TODO placeholders.
- [ ] Confirm the document does not contradict `docs/architecture/overview.md`.
- [ ] Confirm the document does not describe already-missing capabilities as if they already exist; use "目标边界" / "需要具备" wording where appropriate.
