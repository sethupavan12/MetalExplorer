# MetalExplorer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first locally runnable macOS desktop version of MetalExplorer: a modern task manager with process explainability, local dev service discovery, optional AI explanations, and safe process termination.

**Architecture:** Electron owns OS access, settings, process termination, and AI calls. React owns the UI and talks to Electron through a typed preload bridge. Process parsing and classification are pure modules covered by tests.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest, lucide-react, Electron safeStorage, macOS `ps`, macOS `lsof`, OpenAI-compatible Chat Completions.

---

## File Map

- `package.json`: scripts and dependencies.
- `electron.vite.config.ts`: Electron/Vite build entries.
- `tsconfig.json`, `tsconfig.node.json`: TypeScript config.
- `index.html`: renderer mount point.
- `src/shared/types.ts`: shared process, settings, AI, and IPC types.
- `src/main/index.ts`: Electron app lifecycle and IPC handlers.
- `src/main/processes.ts`: macOS process collection, parsing, classification, summaries, and guarded termination.
- `src/main/settings.ts`: local settings persistence and encrypted API key handling.
- `src/main/ai.ts`: OpenAI-compatible AI explanation client and response parsing.
- `src/preload/index.ts`: typed safe renderer bridge.
- `src/renderer/main.tsx`: React bootstrap.
- `src/renderer/App.tsx`: app state, layout, filtering, and actions.
- `src/renderer/styles.css`: production UI styling.
- `tests/processes.test.ts`: parser and classifier tests.
- `tests/ai.test.ts`: AI response parser tests.
- `README.md`: project overview, setup, privacy model, and GitHub publishing notes.

## Task 1: Scaffold Project

- [ ] Create npm, Electron/Vite, React, TypeScript, and Vitest configuration.
- [ ] Install runtime dependencies: `@fontsource/ibm-plex-mono`, `@fontsource/ibm-plex-sans`, `@vitejs/plugin-react`, `electron`, `electron-vite`, `lucide-react`, `react`, `react-dom`, `vite`.
- [ ] Install dev dependencies: `@types/node`, `@types/react`, `@types/react-dom`, `typescript`, `vitest`.
- [ ] Add scripts: `dev`, `build`, `preview`, `test`.

## Task 2: Write Failing Core Tests

- [ ] Add tests for `parsePsOutput`.
- [ ] Add tests for `parseLsofOutput`.
- [ ] Add tests for `parseElapsedToSeconds`.
- [ ] Add tests for process classification and summary generation.
- [ ] Add tests for AI JSON extraction and fallback text parsing.
- [ ] Run `npm test` and verify the tests fail because modules are missing.

## Task 3: Implement Core Main Modules

- [ ] Implement shared types.
- [ ] Implement process parser, port parser, classifier, summary builder, and snapshot collector.
- [ ] Implement guarded SIGTERM for safe user-owned termination.
- [ ] Implement settings persistence with Electron safeStorage for remembered API keys.
- [ ] Implement OpenAI-compatible Chat Completions calls using the configured base URL, model, and API key.
- [ ] Run `npm test` and verify the core tests pass.

## Task 4: Implement Electron Shell

- [ ] Add Electron main process lifecycle.
- [ ] Add IPC handlers for process snapshots, termination, settings, and AI explanation.
- [ ] Add preload bridge with a typed `window.metalExplorer` API.
- [ ] Build the Electron bundle and fix TypeScript issues.

## Task 5: Build Renderer UI

- [ ] Build a dashboard strip with totals, local servers, AI agents, and clean candidates.
- [ ] Build process table sorting, filtering, category chips, port visibility, and resource bars.
- [ ] Build inspector panel with details, AI explanation, settings, and guarded terminate action.
- [ ] Style the app with a dense "signal desk" visual system using IBM Plex Sans and IBM Plex Mono.
- [ ] Ensure no visible instructional copy replaces actual controls.

## Task 6: Verify

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev` and provide the local app URL or command.
- [ ] Confirm the app can list local processes and listening ports on macOS.
