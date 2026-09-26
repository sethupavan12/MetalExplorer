# Development Guide

MetalExplorer is a macOS Electron app built with Vite, React, and TypeScript.

## Requirements

- macOS
- Node.js 22.12+
- npm 10+

## Setup

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and opens a real Electron window.

## Scripts

```bash
npm test
```

Runs Vitest tests for process parsing, classification, and AI explanation parsing.

```bash
npm run build
```

Type-checks and builds main, preload, and renderer bundles.

```bash
npm run visual:smoke
```

Builds the app and runs an offscreen Electron smoke test. It verifies:

- app shell mounted
- raw CSS is not rendered in the body
- table views can scroll
- dashboard and table rows stay in the correct grid row
- light, dark, and Matrix themes keep readable contrast
- filter controls open and close on table views

```bash
npm run package:mac
```

Creates a local unpacked app at:

```text
release/mac-arm64/MetalExplorer.app
```

```bash
npm run dist:mac
```

Creates distributable artifacts through `electron-builder`. Public distribution still needs Apple Developer ID signing and notarization.

## Project structure

```text
src/main
  Electron main process, macOS commands, process parsing, AI calls, settings.

src/preload
  Context-isolated bridge between renderer and main process.

src/renderer
  React UI, themes, panes, tables, dashboard, inspector, settings.

src/shared
  TypeScript contracts shared by main, preload, and renderer.

tests
  Unit tests.

scripts
  Visual smoke test and preload mock data.
```

## Working on process parsing

Process parsing and classification live in `src/main/processes.ts`. Cross-sample state (CPU and network deltas, history, guarded stops) lives in `src/main/sampler.ts`. Coding agent detection lives in `src/main/agent-catalog.ts` and `src/main/agents.ts`; token usage parsing in `src/main/agent-usage.ts`.

Run tests after changes:

```bash
npm test -- tests/processes.test.ts tests/agents.test.ts
```

Any change to `parsePsOutput`, `parseLsofOutput`, `parseEstablishedLsofOutput`, `classifyProcess`, `detectCodingAgent`, `buildAgentSessions`, the usage readers, or `Sampler.terminate` should include a test.

## Adding a coding agent

Add an entry to `CODING_AGENTS` in `src/main/agent-catalog.ts` with the exact executable names and npm package paths, then add a color and monogram in `src/renderer/lib/model.ts` and a detection test in `tests/agents.test.ts`. Matching is exact on purpose; never add substring hints.

## Working on AI explanations

AI parsing lives in `src/main/ai.ts`.

Run:

```bash
npm test -- tests/ai.test.ts
```

The parser should tolerate:

- valid JSON
- fenced JSON
- nested JSON inside summary
- plain text fallback

The UI should show the summary, not raw JSON.

## Working on UI

The app shell is `src/renderer/App.tsx`. Views live in `src/renderer/views`, shared components in `src/renderer/components`, and pure helpers in `src/renderer/lib`. Design tokens and themes are at the top of `src/renderer/styles.css`.

After UI changes:

```bash
npm run visual:smoke
```

The smoke test renders every view in Light, Dark, and Matrix, fails on layout regressions, and writes screenshots to `release/visual/`. Set `SMOKE_WIDTH` and `SMOKE_HEIGHT` to check other window sizes (the default window is 1320x860). Do not commit `release/` artifacts.

## Troubleshooting

If the packaged app opens as a blank or broken window:

```bash
pkill -x MetalExplorer || true
npm run package:mac
open -n release/mac-arm64/MetalExplorer.app
```

If you need to inspect the packaged app:

```bash
release/mac-arm64/MetalExplorer.app/Contents/MacOS/MetalExplorer --remote-debugging-port=9333
```

Then open:

```text
http://127.0.0.1:9333/json/list
```

## Before opening a PR

Run:

```bash
npm test
npm run build
npm run visual:smoke
```

If the PR changes safety-sensitive behavior, also update:

- `docs/SAFETY_AND_PRIVACY.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
