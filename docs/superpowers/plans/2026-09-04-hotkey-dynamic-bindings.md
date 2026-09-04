# Dynamic Hotkey Bindings

## Scope

- Add one centralized desktop keydown dispatcher with platform-normalized keys.
- Support G-prefixed chords, input/composition guards, scope filtering, and localStorage overrides.
- Expose page, project, workspace, session, and general actions in Settings.
- Keep Workspace business logic intact; connect actions through a DOM event bus.

## Delivery Slices

1. H1: dispatcher, key normalization, registry, chord state machine.
2. H2: action registry, persistent overrides, conflict fallback, project-tab migration.
3. H3: Settings list, recorder, reset/disable controls.
4. H4: Workspace and SessionBar focus, navigation, project/session actions.

## Verification

- UI TypeScript check.
- Hotkey registry/action/store tests.
- UI lint and production build.
- Full Vitest suite, with unrelated runtime-crash timeout recorded if reproduced.
