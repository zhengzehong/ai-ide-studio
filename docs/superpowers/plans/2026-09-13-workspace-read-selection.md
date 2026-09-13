# Workspace selection and read acknowledgement

## Goal

Keep ordinary Agent selection consistent with the rendered conversation. Switching to a team must not restore or acknowledge an ordinary conversation in the background. Task updates must not change navigation.

## Checklist

- [x] Inspect selection, restore, and read acknowledgement consumers.
- [x] Add regression coverage for team switching, restore synchronization, and hidden conversation completion.
- [x] Limit restoration to initial/project entry and synchronize the Agent with the restored Session.
- [x] Acknowledge automatic reads only for mounted, visible ordinary conversations; preserve explicit unread behavior.
- [x] Run focused tests, npm test, npm run build, npm run lint, and git diff --check.
- [x] Review the final diff for the scoped PRD merge.

## Scope and acceptance

PC Workspace and its ordinary Session store only. Preserve team stores, task dispatch, APIs, database schema, and mobile behavior. Cover normal reading, team/file/page switches, return to a completed Session, project entry, and explicit unread fences. Add architecture documentation for any extracted helper. Production services and unrelated worktree changes remain untouched.

## Validation and delivery

The original code failed four hidden-conversation regression cases. The fixed code passed the complete suite (477 files, 2659 tests), including five isolated Chromium/React lifecycle cases. Build, lint, and diff checks passed. One initial full-suite run hit a Windows temporary-directory cleanup EPERM in the unchanged model-proxy Runtime test; the isolated rerun and subsequent full suite passed. The final sidebar highlight adjustment passed the focused 20-case suite and a fresh build/lint.

Commit and merge into PRD without starting or restarting application services. Record the resulting commit identifiers and integration verification in task-0d5564ce; no production deployment is included.
