# Hide Team Agent Tools Implementation Plan

**Goal:** Keep Team domain features intact while hiding every `team.*` method from Claude Code and Codex tool lists.

**Architecture:** Add one static Agent exposure policy and apply it in both platform tool resolvers. Preserve tool rows, bindings, profiles, handlers, Team RPCs, and Team data so the feature can be restored by removing the policy.

## Steps

- [x] Add a shared policy that rejects `team.*` tool names for Agent exposure.
- [x] Apply the policy to HTTP MCP visibility and stdio Runtime tool resolution.
- [x] Update resolver/Profile/Team tests to prove bindings remain but no Team method is exposed.
- [x] Update architecture and README wording to distinguish registered Team capability from Agent exposure.
- [x] Run targeted tests, full tests, lint, build, typecheck, and diff checks.
- [x] Commit only scoped files directly to `prd` without restarting the PRD service.
