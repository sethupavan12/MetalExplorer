# Security Policy

MetalExplorer is a local macOS process inspector with optional AI explanations. Security reports are welcome.

## Supported versions

This project is pre-1.0. Security fixes should target the current `main` branch until formal releases exist.

## Reporting a vulnerability

Do not open a public issue with exploit details.

Use GitHub private vulnerability reporting:

```text
https://github.com/sethupavan12/metalexplorer/security/advisories/new
```

If private vulnerability reporting is not enabled yet, open a public issue that says you need a private security contact, but do not include sensitive details.

## What counts as security-sensitive

Please report issues involving:

- API key exposure.
- Process command data being sent to AI without user action.
- Stored process or network history that the UI does not disclose.
- Termination guard bypasses.
- Ability to terminate root-owned, system, or MetalExplorer processes through the UI.
- Opening non-local URLs through the service opener.
- Remote code execution in the renderer or preload bridge.
- Unexpected external network requests.

## Current trust boundaries

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- OS access lives in the Electron main process.
- The preload bridge exposes only a typed `metalExplorer` API.
- AI calls happen only after `AI Explain` is clicked.
- API keys are in memory by default.
- Remembered API keys use Electron `safeStorage` when available.

See [Safety and Privacy](docs/SAFETY_AND_PRIVACY.md) for the full model.
