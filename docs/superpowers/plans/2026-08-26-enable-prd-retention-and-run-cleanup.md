# Enable PRD Retention And Run Cleanup

## Goal

Enable scheduled deletion-mode retention by default for the local PRD startup script, then run one manual cleanup against the current PRD instance without restarting it.

## Scope

- Set `DATA_RETENTION_MODE` to `delete` by default in `scripts/start-prd-local.ps1`.
- Preserve an explicitly supplied `DATA_RETENTION_MODE` override.
- Print the selected retention mode during startup.
- Run the existing manual retention delete command against `data-prd` on port `18900`.
- Monitor cleanup status and PRD HTTP availability until the run finishes.

## Steps

1. Update the PRD startup script and validate its PowerShell syntax.
2. Run focused retention tests, lint, build, and `git diff --check`.
3. Start a manual confirmed cleanup through the existing retention control API.
4. Poll retention status and the PRD workspace endpoint until cleanup completes.
5. Report deleted row counts, errors, and remaining candidates.

## Acceptance Criteria

- A normal PRD script launch defaults to `DATA_RETENTION_MODE=delete`.
- An explicit `off` or `dry-run` environment value remains respected.
- The current PRD process is not restarted.
- Manual cleanup completes or is stopped on a verified service-impacting error.
- Messages and the latest 15 completed Agent turns remain outside deletion scope.
