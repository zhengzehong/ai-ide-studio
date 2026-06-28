# Mobile Android One Click Build Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a directly executable script under `scripts/` so Android debug APK packaging can be started without typing npm commands.

**Architecture:** Keep the existing `scripts/build-mobile-android-debug.mjs` as the single packaging implementation. Add a Windows batch wrapper that resolves the repo root, calls the Node script, reports the APK path, and pauses when launched by double click.

**Tech Stack:** Windows batch, Node.js, Capacitor Android debug build.

---

### Task 1: Add Direct Windows Build Script

**Files:**
- Create: `scripts/build-mobile-android-debug.bat`

- [x] **Step 1: Create batch wrapper**

Create a batch script that:
- switches to the repository root
- checks `node` is available
- calls `node scripts\build-mobile-android-debug.mjs`
- prints `release\AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk`
- pauses before closing

Expected: double-clicking the script starts the APK build.

### Task 2: Verify And Commit

**Files:**
- Modify: this plan file
- Create: `scripts/build-mobile-android-debug.bat`

- [x] **Step 1: Run the batch script**

Run:
- `.\scripts\build-mobile-android-debug.bat`

Expected: script exits 0 and writes `release\AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk`.

- [x] **Step 2: Check Git state**

Run:
- `git status --short --branch`
- `git diff --check`

Expected: only this plan file and the new batch script are changed; `问题登记表.xlsx` remains untracked.

- [x] **Step 3: Commit**

Run:
- `git add docs/superpowers/plans/2026-06-12-mobile-android-one-click-build-script.md scripts/build-mobile-android-debug.bat`
- `git commit -m "chore: add mobile android one-click build script"`

Expected: commit is created on `prd`.
