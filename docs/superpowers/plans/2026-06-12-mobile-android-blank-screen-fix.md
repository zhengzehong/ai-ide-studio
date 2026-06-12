# Mobile Android Blank Screen Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the installed Android APK showing a blank screen while preserving the existing mobile web `/app` behavior.

**Architecture:** Keep the web build on `/app/` and `BrowserRouter basename="/app"`. Mark Android packaging with an environment variable so Vite emits relative APK assets and React uses `HashRouter` inside Capacitor.

**Tech Stack:** Vite, React Router, Capacitor Android, Node build script.

---

### Task 1: Make Android Packaging Emit APK-Friendly Assets

**Files:**
- Modify: `scripts/build-mobile-android-debug.mjs`
- Modify: `mobile/vite.config.ts`

- [x] **Step 1: Set Android build target in packaging script**

Set `MOBILE_BUILD_TARGET=android` before running the mobile build.

Expected: Android packaging can be detected by Vite and app code.

- [x] **Step 2: Use relative Vite base only for Android**

In `mobile/vite.config.ts`, use `base: './'` when `MOBILE_BUILD_TARGET=android`; otherwise keep `base: '/app/'`.

Expected: Web build still references `/app/assets/...`; Android build references `./assets/...`.

### Task 2: Use Android-Friendly Router Without Changing Web

**Files:**
- Modify: `mobile/src/App.tsx`

- [x] **Step 1: Add router adapter**

Use `HashRouter` when `MOBILE_BUILD_TARGET=android`, and keep `BrowserRouter basename="/app"` for web builds.

Expected: Android APK routes do not depend on a native `/app` path.

### Task 3: Verify, Commit, And Rebuild APK

**Files:**
- Modify: this plan file

- [x] **Step 1: Verify web build**

Run:
- `npm run build:mobile`

Expected: `mobile/dist/index.html` still contains `/app/assets/`.

- [x] **Step 2: Verify Android build**

Run:
- `.\scripts\build-mobile-android-debug.bat`

Expected: Android build exits 0 and `mobile/dist/index.html` contains `./assets/`.

- [x] **Step 3: Run checks**

Run:
- `npm run lint -w mobile`
- `npx vitest run tests/unit/mobile-turn-content-state.test.ts tests/unit/mobile-chat-store.test.ts tests/unit/mobile-chat-elapsed.test.ts`
- `git diff --check`

Expected: all checks pass.

- [x] **Step 4: Commit**

Run:
- `git add docs/superpowers/plans/2026-06-12-mobile-android-blank-screen-fix.md mobile/src/App.tsx mobile/vite.config.ts scripts/build-mobile-android-debug.mjs`
- `git commit -m "fix: make mobile android apk load bundled assets"`

Expected: commit is created on `prd`; `问题登记表.xlsx` remains untracked.
