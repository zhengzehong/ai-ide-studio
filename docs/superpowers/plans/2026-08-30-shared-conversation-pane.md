# Shared Conversation Pane

## Goal

Add a reusable middle conversation surface for PC pages. `/updates` will use the new surface; the existing Workspace page and its behavior remain unchanged.

## Scope

1. Define a store-agnostic conversation adapter contract for messages, streaming turns, capabilities, usage, interactions, pagination, process/file detail loading, attachments, drafts, and session actions.
2. Add shared conversation components for message rendering, scroll anchoring, composer controls, and interaction states.
3. Extend the workbench session store to implement the adapter without selecting or mutating Workspace's global session.
4. Replace only `UpdatesConversation` with the shared component and preserve the updates header/session pin behavior.
5. Add focused tests for adapter behavior, scroll/pagination behavior, composer state, and updates integration.

## Non-goals

- Do not replace or modify `Workspace.tsx`.
- Do not change backend RPCs, database schema, or APP behavior.
- Do not change updates sidebar or preview column behavior.

## Acceptance

- `/updates` supports Workspace-equivalent middle-pane behavior for history pagination, streaming process/reply, interactions, attachments, drafts, model/mode/config controls, file changes, statistics, and queued prompts where the existing protocol supports them.
- Workspace source and runtime behavior are unchanged.
- Shared components stay below the repository file-size limits.
- Targeted tests, lint, build, and non-baseline full tests pass.
