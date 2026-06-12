# PRD LAN Mobile Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Android app connect to the PRD instance from the same LAN using a URL such as `http://192.168.115.42:18900`.

**Architecture:** Update the PRD startup script to bind the backend to all interfaces and publish a LAN base URL. Add a startup firewall-rule check for TCP 18900. Allow Android WebView cleartext traffic so `http://` and `ws://` local-network connections are permitted.

**Tech Stack:** PowerShell startup script, Windows Firewall, Android Manifest, Capacitor Android debug APK.

---

### Task 1: Update PRD Startup For LAN Access

**Files:**
- Modify: `scripts/start-prd-local.ps1`

- [x] **Step 1: Bind PRD server to all interfaces**

Set `HOST` to `0.0.0.0` by default, while still allowing an explicit environment override.

Expected: the backend can listen on LAN interfaces, not only `127.0.0.1`.

- [x] **Step 2: Publish LAN base URL**

Detect the first non-loopback IPv4 address and set `PUBLIC_BASE_URL` to `http://<lan-ip>:<port>` when not explicitly provided.

Expected: startup output shows a LAN URL such as `http://192.168.115.42:18900`.

- [x] **Step 3: Check Windows Firewall**

Ensure a local inbound TCP rule for the selected port exists, or print a clear warning if creating it fails.

Expected: startup script helps avoid the common "same Wi-Fi but cannot connect" failure.

### Task 2: Allow Android Cleartext LAN Connections

**Files:**
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`

- [x] **Step 1: Enable cleartext traffic**

Add `android:usesCleartextTraffic="true"` to the `<application>` tag.

Expected: Android WebView can open `http://` and `ws://` LAN URLs for debug testing.

### Task 3: Verify And Package

**Files:**
- Output: `release/AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk`

- [x] **Step 1: Run checks**

Run:
- `npm run build`
- `npm run lint -w mobile`
- `npx vitest run tests/unit/mobile-turn-content-state.test.ts tests/unit/mobile-chat-store.test.ts tests/unit/mobile-chat-elapsed.test.ts`
- `git diff --check`

Expected: all checks pass.

- [x] **Step 2: Build APK**

Run:
- `.\scripts\build-mobile-android-debug.bat`

Expected: APK build exits 0 and release APK has non-zero size.

- [x] **Step 3: Commit**

Run:
- `git add docs/superpowers/plans/2026-06-12-prd-lan-mobile-connectivity.md scripts/start-prd-local.ps1 mobile/android/app/src/main/AndroidManifest.xml`
- `git commit -m "fix: allow mobile app to connect to prd over lan"`

Expected: commit is created on `prd`; `问题登记表.xlsx` remains untracked.
