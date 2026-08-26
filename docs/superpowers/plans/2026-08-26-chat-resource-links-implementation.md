# Chat Resource Links Implementation Plan

## Goal

Open Agent-authored file and directory Markdown links inside the existing PC and APP file experiences, including project-relative and host absolute paths, without navigating the Electron renderer to local filesystem URLs.

## Implementation Steps

1. Add a read-only filesystem reference resolver that returns a canonical path and `file` or `directory` kind, and make directory listing accept the same validated path forms.
2. Add shared frontend link classification and a project-resource link component while preserving normal external links.
3. Pass project context and resource-open callbacks through PC chat rendering; reuse Workspace file mode, FileTree, and FilePreview for files and directory roots.
4. Add the same project-resource link behavior to APP chat; reuse FileDetail and a compact full-screen directory overlay.
5. Cover Windows absolute paths, relative paths, exact external-link behavior, missing resources, directory navigation, and PC/APP callback propagation.
6. Run targeted tests, full tests, TypeScript, lint, build, and diff checks; complete independent review before merging to `prd`.

## Acceptance Criteria

- Windows drive, UNC, `file://`, and project-relative links are not stripped by Markdown rendering.
- Clicking a file opens the existing internal preview; clicking a directory opens an internal tree and child files remain selectable.
- The full resolved path is visible in a tooltip and can be copied.
- HTTP/HTTPS links retain their existing external behavior.
- Missing or inaccessible resources show a clear error instead of a dead blue link.
- Browser, managed-local EXE, remote EXE, and APP use server-side resolution and do not require client filesystem access.
- No database migration or Electron privileged filesystem IPC is added.
