# MetalExplorer v0.3.0 Release Notes

Release date: 2026-05-21

## Highlights

- Added process provenance with executable, parent process, launch method, project detection, and command preview.
- Added classification confidence and visible evidence signals for local rules.
- Replaced direct stop actions with review sheets for single-process termination and cleanup batches.
- Added network destination intelligence: remote address, port, service label, direction, remote scope, and likely encryption status.
- Added service/project grouping so related local tools are easier to scan.
- Added local 24-hour resource trends for CPU, memory, and aggregate network rates.
- Added user rules and profiles for always-keep, always-flag, Focus, Deep Dev, Strict, and Balanced modes.
- Added richer filters for databases, high-traffic processes, and non-local activity.
- Added a command palette for fast navigation and selected-process actions.
- Added local classification report export for false-positive reports and maintainer debugging.
- Updated privacy documentation for local trends, user rules, AI payload metadata, and classification reports.

## Safety Notes

- AI calls remain explicit and on demand.
- Local trend storage does not include full commands, command arguments, AI responses, remote hosts, or remote ports.
- Termination still uses guarded `SIGTERM`; no root-owned or protected process termination was added.
- Classification reports are written only when the user chooses a save location.

## Known Limitations

- Trend data starts collecting after the new version runs; there is no backfill.
- Project grouping is heuristic and based on command paths and runtime hints.
- Network destination labels are derived from ports and addresses, not packet inspection.
- Packaged local builds are ad-hoc signed unless release signing and notarization credentials are configured.
