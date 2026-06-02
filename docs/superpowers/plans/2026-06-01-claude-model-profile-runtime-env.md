# Claude Model Profile Runtime Env Fix

**Goal:** Make an Agent-bound Claude model profile take effect when starting the Claude ACP runtime.

**Root Cause:** Model profiles are persisted and bound through `agents.config_json.modelProfileId`, but ACP startup/session creation did not pass the profile values into Claude Code's own settings layer. Claude ACP can receive the correct process env while Claude Code still merges `settings.json.env` later, so the profile must also be sent through session `_meta.claudeCode.options.settings.env`.

**Success Criteria:**
- A Claude Agent bound to a model profile injects provider and model settings into the spawned runtime environment.
- Claude session creation/resume/load passes profile-derived `settings.env` through ACP `_meta`, so Claude Code alias handling uses the bound profile without host-side alias rewriting.
- The injected settings are process-local and do not modify local Claude/Codex config files.
- Existing Codex runtime env behavior remains unchanged.

## Tasks

- [x] Add a unit test for Claude model profile env mapping.
- [x] Add a scoped runtime-env helper that resolves the Agent binding and model profile.
- [x] Use that helper in the ACP host spawn path.
- [x] Pass Claude profile env through session `_meta.claudeCode.options.settings.env`.
- [ ] Run the targeted test and report any unrelated verification blockers.
