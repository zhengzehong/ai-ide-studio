# Global Assistant Reply And Project Context Fix

## Goal

Fix two global assistant regressions:

1. Completed global assistant replies with lazy-loaded process items must show their final answer after refresh.
2. Global assistant prompts must carry the current project context so project-scoped tools create/list data in the active project.

## Steps

1. Add regression tests.
   - Verify a completed global assistant message with `content` and `process_item_count` still exposes final answer before process items load.
   - Verify a global assistant prompt can pass a temporary project context to ACP while keeping the global assistant workspace cwd.

2. Implement minimal changes.
   - Adjust global assistant bubble final-answer fallback.
   - Send current project id with global assistant prompts.
   - Thread optional prompt project context through the WS prompt handler and session manager.
   - Resolve global assistant ACP context with injected project id and existing global workspace cwd.

3. Verify.
   - Run targeted tests for global assistant store/RPC/session context.
   - Run broader tests/build/lint as time permits before committing.

4. Commit and sync.
   - Commit the focused fix on the current branch.
   - Cherry-pick the commit into the prd checkout/branch.
