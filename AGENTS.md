# Agent Guidelines

This repository is safety-sensitive because it inspects local processes, network connections, API key settings, and termination actions.

When using AI coding agents in this repo:

- Do not add telemetry or external requests without updating `docs/SAFETY_AND_PRIVACY.md`.
- Do not send process data to AI automatically.
- Do not persist process or network history without an explicit privacy design.
- Do not loosen termination guards without tests.
- Keep OS access in `src/main`.
- Keep renderer code behind `src/preload/index.ts`.
- Run `npm test`, `npm run build`, and `npm run visual:smoke` before claiming UI or safety-sensitive work is complete.
- After meaningful app or UI changes, build the app and show the user the latest running app or verified screenshots before wrapping up.

Important files:

```text
src/main/sampler.ts          sampling, history, guarded termination
src/main/processes.ts        process parsing, network parsing, classification
src/main/agents.ts           coding agent sessions and process trees
src/main/agent-usage.ts      opt-in local token usage reader
src/main/ai.ts               AI explanation payload and parser
src/main/settings.ts         local settings and API key storage
src/preload/index.ts         renderer API boundary
src/renderer/App.tsx         app shell; views in src/renderer/views
src/renderer/styles.css      layout and themes
docs/SAFETY_AND_PRIVACY.md   user trust contract
ARCHITECTURE.md              trust boundaries and data flow
```
