# Mobile App Delivery Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the mobile app delivery gaps found in review so the app source, packaging path, runtime behavior, and docs agree.

**Architecture:** Keep the mobile app as a separate Vite workspace served under `/app/`. Share existing desktop protocol helpers only where they are already used, and keep fixes focused on packaging, connection state, project-scoped refresh, and task status display.

**Tech Stack:** TypeScript, React, Zustand, Vite, Vitest, Electron Builder.

---

### Task 1: Add Regression Coverage

**Files:**
- Create: `tests/unit/mobile-session-store.test.ts`
- Create: `tests/unit/mobile-task-status.test.ts`
- Modify: `vitest.config.ts`

- [ ] Write a failing test that verifies mobile session refresh preserves the selected project id.
- [ ] Write a failing test that verifies mobile task status labels cover backend `TaskStatus` values.
- [ ] Run the focused tests and confirm they fail before implementation.

### Task 2: Fix Mobile Runtime Behavior

**Files:**
- Modify: `mobile/src/stores/session.store.ts`
- Modify: `mobile/src/pages/TaskListPage.tsx`
- Modify: `mobile/src/pages/ConnectPage.tsx`

- [ ] Preserve the current project id when session events trigger refresh.
- [ ] Use backend task status values for mobile task badges.
- [ ] Navigate away from the connect page only after the WebSocket reports connected, and show a failure hint otherwise.
- [ ] Run focused tests and mobile TypeScript build.

### Task 3: Complete Build And Packaging Path

**Files:**
- Modify: `package.json`
- Modify: `scripts/electron-builder.mjs`
- Modify: `electron/backend-launch.ts`

- [ ] Make the root production build include the mobile workspace.
- [ ] Include `mobile/dist` in Electron packaged resources.
- [ ] Set `MOBILE_STATIC_DIR` for the packaged backend process.
- [ ] Run root build and inspect packaging config paths.

### Task 4: Sync Docs And Quality Gates

**Files:**
- Modify: `README.md`
- Modify: `docs/design/mobile-app.md`
- Modify: `mobile/package.json`

- [ ] Document mobile dev/build commands and `/app/` access.
- [ ] Update the design doc so it matches the implemented backend/static serving approach.
- [ ] Add a mobile lint script and include it in the root lint command.
- [ ] Run `npm run lint`, `npm test`, `npm run build`, and `npm run build:mobile`.
