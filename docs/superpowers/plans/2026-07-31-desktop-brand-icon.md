# Desktop brand icon

## Goal

Use the Widget's black Sparkles mark as the single desktop application icon instead of Electron's default icon.

## Scope

1. Add a high-resolution application icon matching the Widget mark.
2. Use the same asset in the Widget header.
3. Apply the icon to the main, setup, and Widget BrowserWindows and the tray.
4. Configure Electron Builder to embed the icon in Windows executables and installers.
5. Package the runtime icon as an extra resource with a development fallback.
6. Add focused tests, run the full verification suite, merge to `prd`, and build updated Windows artifacts without restarting PRD.

## Verification

- Widget and desktop application use the same source artwork.
- Packaged resources contain `app-icon.png`.
- Electron Builder no longer reports that the default Electron icon is used.
- Unit tests, lint, production build, Electron build, and `git diff --check` pass.
