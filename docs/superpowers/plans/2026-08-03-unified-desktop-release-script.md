# Unified Desktop Release Script

## Goal

Provide one repeatable desktop packaging command that preserves Android APKs in
`release/`, replaces only desktop artifacts, and leaves exactly the installer,
portable executable, and `win-unpacked` directory as desktop deliverables.

## Steps

1. Add testable release-path and artifact-promotion helpers with strict workspace
   boundary checks and APK preservation coverage.
2. Add a Node packaging entry point that builds into staging, validates all three
   desktop outputs, promotes them into `release/`, and prints absolute paths plus
   SHA256 hashes.
3. Make Electron Builder accept the staging output directory and expose the
   command through `package.json`.
4. Update the desktop packaging guide and README command reference.
5. Run targeted tests, the full test suite, lint, build, and a real Windows
   desktop package. Verify the APK hash is unchanged and all three desktop
   deliverables start or exist as expected.
6. After the package passes review and is merged, remove legacy top-level
   `release-*` delivery directories from the main workspace while retaining the
   canonical `release/` directory.

## Acceptance Criteria

- Existing `release/*.apk` files are never deleted or modified by desktop packaging.
- Old desktop EXEs, metadata, and `win-unpacked` are replaced only after a complete
  staging build succeeds.
- `npm run package:desktop` produces the installer, portable executable, and
  `release/win-unpacked` from the current commit.
- The command prints stable absolute paths, sizes, and SHA256 hashes.
- No PRD service restart or online database access occurs.
