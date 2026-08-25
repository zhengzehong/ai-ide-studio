# Workspace File Focus Implementation Plan

## Goal

Make the Workspace file tab a focused layout that replaces the Session bar and conversation area with a wide file viewer while preserving the right task panel.

## Changes

1. Add a small center-stage component that owns file/chat mode visibility.
2. Keep the chat pane mounted and hide it with CSS in file mode so drafts, scroll state, and streaming updates survive tab changes.
3. Remove the disabled `文件浏览中` placeholder and the fixed 420px file preview column.
4. Let the file viewer consume all space between the 220px file tree and 380px task panel.
5. Show a quiet file-selection empty state when no file is open.
6. Add focused rendering tests for both modes and state preservation.

## Verification

- Focused Workspace layout tests
- `npm test`
- `npm run build`
- `npm run lint`
- `git diff --check`

## Acceptance Criteria

- File mode has no Session bar placeholder or visible conversation pane.
- File content uses a flexible full-width center stage.
- The task panel remains unchanged.
- Switching modes does not unmount the chat pane.
- Session mode behavior remains unchanged.
