# Preview Assets And History Plan

## Goal

Keep published prototypes styled and interactive when their relative CSS, JavaScript, image, and font assets are requested, and make refreshed preview cards stable for both Claude and Codex sessions.

## Changes

1. Issue a preview-path scoped HttpOnly cookie after a valid preview token request; accept that cookie for subresource requests.
2. Reject entry files that escape the published source directory.
3. Deduplicate persisted preview/file presentations by their stable IDs.
4. Add HTTP, handler, and persistence regression tests.

## Acceptance

- Root preview request with the local token succeeds and sets a scoped cookie.
- Relative CSS request succeeds with the cookie and remains unauthorized without it.
- Traversal entry files are rejected.
- Duplicate tool results produce one persisted presentation.
- Existing Claude and Codex title parsing and refresh recovery remain unchanged.
