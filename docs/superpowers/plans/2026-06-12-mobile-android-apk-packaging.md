# Mobile Android APK Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing Capacitor Android project and produce a debug APK for the mobile app on the `prd` branch.

**Architecture:** Keep the existing mobile React/Vite app as the UI source. Use Capacitor to wrap `mobile/dist` into a native Android WebView project under `mobile/android`, and add npm scripts so future APK builds are repeatable from the repo.

**Tech Stack:** React 19, Vite 8, Capacitor 8, Android Gradle project, Android Studio JBR 21, Android SDK.

---

### Task 1: Add Capacitor Android Dependencies And Scripts

**Files:**
- Modify: `mobile/package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Install Capacitor packages**

Run:
- `npm install -w mobile @capacitor/core @capacitor/android`
- `npm install -w mobile -D @capacitor/cli`

Expected: `mobile/package.json` and `package-lock.json` contain Capacitor packages.

- [x] **Step 2: Add repeatable Android scripts**

Add mobile workspace scripts:
- `android:sync`: `npm run build && cap sync android`
- `android:debug`: `npm run android:sync && cd android && gradlew.bat assembleDebug`

Expected: future debug APK builds can be run from `mobile` with `npm run android:debug`.

### Task 2: Generate Android Project

**Files:**
- Create: `mobile/android/**`

- [x] **Step 1: Generate Capacitor Android project**

Run from `mobile`:
- `npx cap add android`

Expected: `mobile/android` exists with Gradle wrapper and app project files.

- [x] **Step 2: Sync current mobile build**

Run from repo root:
- `npm run build:mobile`
- `npx cap sync android` from `mobile`

Expected: Capacitor copies `mobile/dist` into the Android project.

### Task 3: Build And Export Debug APK

**Files:**
- Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- Output: `release/AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk`

- [x] **Step 1: Build debug APK**

Run from `mobile/android`:
- `.\gradlew.bat assembleDebug`

Expected: Gradle exits 0 and produces `app-debug.apk`.

- [x] **Step 2: Copy APK to release directory**

Run from repo root:
- copy `mobile/android/app/build/outputs/apk/debug/app-debug.apk` to `release/AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk`.

Expected: release APK exists and has non-zero size.

### Task 4: Verify, Commit, And Report

**Files:**
- Modify: plan checkboxes in this file
- Review: generated Android project and package changes

- [x] **Step 1: Run verification**

Run:
- `npm run build:mobile`
- `npm run lint -w mobile`
- `npx vitest run tests/unit/mobile-turn-content-state.test.ts tests/unit/mobile-chat-store.test.ts tests/unit/mobile-chat-elapsed.test.ts`
- `mobile/android/gradlew.bat assembleDebug`

Expected: all commands pass.

- [x] **Step 2: Commit Android packaging support**

Run:
- `git add docs/superpowers/plans/2026-06-12-mobile-android-apk-packaging.md mobile package-lock.json`
- `git commit -m "feat: add mobile android apk packaging"`

Expected: commit is created on `prd`; `问题登记表.xlsx` remains untracked.

- [x] **Step 3: Report APK path**

Report:
- latest commit hash
- APK full path
- verification commands and results
