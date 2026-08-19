# Hidden Agent Session Recovery Loop

## Goal

Prevent project entry from repeatedly restoring a session owned by a hidden Agent and clearing it again.

## Scope

- Validate saved project sessions before automatic restore.
- Wait until the project Agent list has finished loading.
- Clear an invalid project last-session mapping when it points to a hidden Agent.
- Keep the change limited to PC Workspace recovery; no database or runtime behavior changes.

## Acceptance

- Hidden Agent sessions are never automatically restored.
- Visible, retained sessions continue to restore normally.
- Entering a project cannot repeatedly trigger `session.getModels` or `sessions.markRead` for a hidden Agent session.
- Existing project/session recovery tests remain green.
