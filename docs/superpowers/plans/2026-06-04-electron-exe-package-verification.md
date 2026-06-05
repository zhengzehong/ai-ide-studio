# Electron Exe Package Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:verification-before-completion before reporting success. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the current project state and produce a Windows Electron exe package if checks pass.

**Architecture:** No application code changes are planned. Run the existing test/build pipeline, then use the existing Electron Builder configuration to generate release artifacts.

**Tech Stack:** npm, Vitest, TypeScript, Vite, Electron Builder.

---

### Task 1: Verification

**Files:**
- No source changes.

- [x] Run `npm test`; observed an unrelated untracked WIP test failure in `tests/integration/ws-copy-session.test.ts`.
- [x] Run full existing tracked tests with `tests/integration/ws-copy-session.test.ts` excluded.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.

### Task 2: Electron Packaging

**Files:**
- Existing: `package.json`
- Existing: `scripts/electron-builder.mjs`
- Existing: `release/`

- [x] Run `npm run build:electron`.
- [x] List generated `release/*.exe` files.
- [x] Confirm whether NSIS installer and portable exe outputs are present.
- [x] Smoke launch `release/win-unpacked/AI IDE Studio.exe` and confirm one packaged backend process starts, then clean it up.
