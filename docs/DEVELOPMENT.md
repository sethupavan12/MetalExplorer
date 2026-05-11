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

Most process behavior is in `src/main/processes.ts`.

Run tests after changes:

```bash
npm test -- tests/processes.test.ts
```

Any change to `parsePsOutput`, `parseLsofOutput`, `parseEstablishedLsofOutput`, `classifyProcess`, or `terminateProcessByPid` should include a test.

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

The main UI lives in `src/renderer/App.tsx` and `src/renderer/styles.css`.

After UI changes:

```bash
npm run visual:smoke
```

Use the generated screenshots in `release/visual-smoke-*.png` for visual inspection. Do not commit `release/` artifacts.

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
