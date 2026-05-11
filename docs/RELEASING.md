# Releasing

MetalExplorer does not have public signed releases yet. This guide is the release path to get there.

## Local package

```bash
npm install
npm run verify
npm run package:mac
open release/mac-arm64/MetalExplorer.app
```

## Public release checklist

Before publishing a GitHub release:

- Verify the app from a clean checkout.
- Verify the packaged `.app`, not only the dev build.
- Confirm `docs/SAFETY_AND_PRIVACY.md` still matches the code.
- Confirm `SECURITY.md` has a real private reporting path.
- Add release notes to `CHANGELOG.md`.
- Decide whether Intel or universal builds are supported.
- Configure Apple Developer ID signing.
- Configure notarization.
- Attach `.dmg` and `.zip` artifacts to GitHub Releases.
- Add SHA-256 checksums.
- Add Homebrew cask instructions only after signed releases exist.

## Build artifacts

Local package:

```bash
npm run package:mac
```

Distributable artifacts:

```bash
npm run dist:mac
```

Current output directory:

```text
release/
```

Do not commit `release/` artifacts.

## Signing and notarization

The current project can create an ad-hoc signed local app. That is enough for local development but not enough for public distribution.

For public release, configure `electron-builder` with Apple Developer ID signing and notarization. Keep secrets out of the repository.

Release automation is defined in `.github/workflows/release.yml`.

Typical GitHub Actions secrets:

```text
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
CSC_LINK
CSC_KEY_PASSWORD
```

Exact setup depends on the maintainer's Apple Developer account and CI provider.

## Versioning

Before 1.0, use:

```text
0.x.y
```

- `x` for user-visible feature releases.
- `y` for fixes and docs.

## Release notes style

Lead with the user-visible change.

Good:

```text
Added Network view for internet-connected processes with upload and download estimates.
```

Weak:

```text
Refactored nettop parsing.
```

Include safety-relevant changes in a `Security` or `Safety` section.
