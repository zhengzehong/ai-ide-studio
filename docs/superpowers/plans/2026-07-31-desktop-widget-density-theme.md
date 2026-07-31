# Desktop density and Widget themes

## Goal

Match the desktop content density to a browser at 90% zoom and resize the Widget to 300x360 with a compact, readable layout and a single-button three-theme cycle.

## Scope

1. Apply a 0.9 zoom factor to the Electron main renderer only.
2. Resize the Widget from 390x570 to 300x360.
3. Preserve the Widget's screen-edge placement while migrating legacy saved bounds.
4. Compact the Widget header, Agent rows, typography, and footer without exceeding two lines per Agent.
5. Add light, yellow, and dark themes selected by one cycling icon button.
6. Persist the selected theme in renderer localStorage without backend changes.
7. Add focused tests and verify desktop/mobile/Web builds without restarting PRD.

## Verification

- Main Electron renderer reports zoom factor 0.9 while ordinary Web is unchanged.
- Widget opens at 300x360 and legacy right/bottom gaps are preserved.
- Theme cycle is light -> yellow -> dark -> light and survives reload.
- Widget has no horizontal overflow at 300px and displays five compact Agent rows.
- Unit tests, full tests, lint, production build, Electron build, and `git diff --check` pass.
