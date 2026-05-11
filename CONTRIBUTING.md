# Contributing

Thanks for helping make local development easier to understand.

MetalExplorer touches process state, network state, API keys, and termination controls. That means contributions need to be careful, boring where safety matters, and explicit about tradeoffs.

## Start with an issue

Open an issue first for:

- new views
- new process classification rules
- termination behavior
- AI behavior
- network collection changes
- new storage
- any background activity
- new external services

Small UI fixes, copy fixes, tests, and documentation improvements can go straight to a pull request.

## Development setup

```bash
npm install
npm run dev
```

Run the checks before opening a pull request:

```bash
npm test
npm run build
npm run visual:smoke
```

## Pull request checklist

- Keep the safety model intact.
- Add or update tests for parser, classifier, AI parsing, or termination changes.
- Update docs if data collection, storage, AI calls, or termination behavior changes.
- Do not add telemetry, update checks, analytics, or external requests without a clear issue and documentation.
- Do not persist process history unless the feature has a privacy design.
- Do not send process data to AI without a user action.
- Do not loosen termination guards without tests.

## Code style

- TypeScript, React, Electron.
- Prefer explicit types at process, IPC, and AI boundaries.
- Keep OS access in `src/main`.
- Keep renderer code behind the preload API.
- Use local helper functions instead of broad abstractions until duplication is real.

## UI direction

MetalExplorer should feel like a polished Mac utility, not a marketing page.

- Dense but readable.
- Calm default colors.
- Clear warning colors for risky actions.
- No decorative gradients or noisy visual effects.
- Tables and inspectors should support scanning.
- Every process-related action needs visible context.

## Safety review expectations

If a PR changes process collection, network collection, AI payloads, API key handling, or termination:

1. Explain what changed.
2. Explain what data is read.
3. Explain what data is stored.
4. Explain what data can leave the machine.
5. Explain what the user can undo.

That explanation belongs in the PR description and, if behavior changes, in `docs/SAFETY_AND_PRIVACY.md`.
