# Codex Fork Event Subscription

## Scope

Restore the copied Codex thread's event subscription before the SDK Runtime host caches it as prompt-ready. Preserve Claude snapshot materialization. Do not change frontend, proxy, database schema or production services.

## Evidence

Installed codex-acp 1.10.0 unsubscribes the native thread after fork. An isolated experiment with the installed Codex 0.153.4 and a fixed local Responses fixture showed: new prompt OK in 236 ms; fork/direct native reply persisted but ACP text/completion absent for 10 seconds; fork/resume/prompt OK in 99 ms. Original session remained usable. This is an event subscription lifecycle defect.

## Checklist

- [x] Inspect existing fork/open/preference paths and create an isolated worktree from prd.
- [x] Add failing host regression tests for fork readiness, streaming, completion, preferences, failure cleanup and sibling isolation.
- [x] Extract fork preparation and resume Codex via the shared session-opening path before caching.
- [x] Validate the fixed host with the real installed ACP/Codex and isolated local Responses fixture.
- [x] Run npm test, npm run build, npm run lint and diff checks; review the final changes.
- [x] Prepare the reviewed commit on the current prd base for merge; preserve unrelated changes and do not restart services. Final integration is recorded by the Git merge commit.

## Acceptance

- A fork's first prompt emits text/tool events and completion to the correct platform Session.
- Failed restore never caches an unusable fork or replaces its history with a new Session.
- Resume/load capability compatibility is handled by existing openSdkSession.
- Model/mode/config preferences use the restored capability snapshot.
- Source Session can continue independently; Claude behavior and existing cancellation tests remain valid.
- Build and tests use isolated output/data directories; production artifacts are not rebuilt.

## Delivery

Platform task/report tools are not exposed in this session; this checklist tracks execution.

- Red/green: seven Codex regression cases failed before the fix; Claude compatibility passed. After the fix all eight new cases plus 24 existing lifecycle cases passed.
- TypeScript noEmit passed.
- Real fixed SdkRuntimeHost -> managed ACP -> Codex -> local fixed Responses fixture passed: new Session 249 ms; fork then immediate ensure/prompt 97 ms; original native thread resumed and prompted 94 ms. Each received OK and end_turn with the correct platform message/session IDs. These are local fixture timings, not inference benchmarks.
- Isolated real-host evidence: main workspace .tmp/codex-fork-repro-1789067814996/report.json. Owned process tree PID 90008 and fixture listener were stopped. No production data or services participated.
- Initial full checks: 449 files / 2498 tests passed with four workers; build passed. Fixed worktree dependency resolution by linking installed node_modules. The existing Windows model-proxy-runtime cleanup EPERM passed on isolated rerun and the subsequent full suite. Lint identified the host logger made unused by extraction; removed it.
- Review checked strict history preservation, original-session routing, readiness before caching, restored capabilities, cleanup error propagation and unchanged Claude behavior. No frontend/proxy/schema changes. Main prd advanced to 4e6d28c during validation; integrate that base and verify before final merge.
- Final integration review on base 4e6d28c: clean rebase, only the intended five files differ. Full suite 452 files / 2518 tests passed; npm run build, npm run lint, npx tsc --noEmit and git diff --check passed. Build has existing bundle-size advisories; final lint has no warnings. No blocking findings.
- Runtime Host is 380 lines and fork preparation 67 lines, within backend limits. New production logic is limited to Codex restore-before-cache plus failure cleanup; the Claude branch is moved without changing its behavior.
- Main checkout's unrelated settings/edge changes remain untouched. Production dist and services are not deployed or restarted; this delivery is code integration only.
