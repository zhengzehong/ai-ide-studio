# Electron Widget Package Fix Plan

**Goal:** Fix the `win-unpacked` startup failure caused by missing Electron main-process modules in the packaged app.

**Success criteria:**
- `win-unpacked/resources/app/electron/dist/widget-window.js` exists after packaging.
- The Electron startup regression test fails without the package filter entry and passes with it.
- `npm run build:electron` completes or any remaining failure is proven to be an external file lock.
- The packaged `win-unpacked/AI IDE Studio.exe` starts without the previous `ERR_MODULE_NOT_FOUND` error.

### Task 1: Reproduce and Guard

- [x] Confirm the startup error points to `electron/dist/widget-window.js`.
- [x] Add a unit test that asserts Electron builder includes the imported module.
- [x] Run the test once to confirm the missing filter is caught.

### Task 2: Package Fix

- [x] Add `widget-window.js` to Electron builder file filters.
- [x] Add `widget-window.js` to the sync script required-file list.
- [x] Re-run the targeted unit test.

### Task 3: Package Verification

- [x] Verify `win-unpacked` contains `widget-window.js`.
- [x] Launch `win-unpacked/AI IDE Studio.exe` and inspect logs/process state.
- [x] Re-run packaging after clearing locked generated artifacts if needed.
- [x] Commit only source/test/doc changes on `prd`.
