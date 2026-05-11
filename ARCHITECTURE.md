# Architecture

MetalExplorer is an Electron app with a strict split between OS access, IPC, and UI.

```text
src/main
  index.ts       Electron window, IPC handlers, external URL guard
  processes.ts   ps/lsof/nettop collection, classification, termination guard
  settings.ts    local settings and API key storage
  ai.ts          OpenAI-compatible explanation calls and JSON normalization

src/preload
  index.ts       typed contextBridge API

src/renderer
  App.tsx        React application and view state
  styles.css     app shell, themes, pane layout, tables, inspector

src/shared
  types.ts       shared contracts between main, preload, and renderer
```

## Data flow

1. The renderer calls `window.metalExplorer.listProcesses()`.
2. The preload bridge forwards the request through Electron IPC.
3. The main process runs macOS tools:
   - `/bin/ps` for process metadata.
   - `/usr/sbin/lsof` for listening ports and established TCP connections.
   - `/usr/bin/nettop` for network byte samples.
4. `src/main/processes.ts` parses and classifies the results.
5. The renderer displays the snapshot in Dashboard, Processes, Services, Agents, Cleanup, and Network views.

Process snapshots are held in memory. They are not written to disk.

## Classification

Classification is local and heuristic-based. It looks at process owner, command path, process name, listening ports, and known hints:

- macOS system services
- local servers
- AI agents and MCP tools
- developer tools
- databases
- browsers
- unknown listeners
- ordinary user apps

The local description is intentionally cautious. It says what the process likely is, not what it certainly is.

## Termination boundary

Termination is handled only in `terminateProcessByPid`.

Before sending a signal, MetalExplorer refreshes the process snapshot and verifies:

- PID is an integer greater than 1.
- PID still exists.
- Process is owned by the current macOS user.
- Process is not MetalExplorer itself.
- Process is not classified as protected.
- Process is not root-owned or an obvious macOS system path.

MetalExplorer sends `SIGTERM`. It does not send `SIGKILL`.

## AI boundary

AI calls live in `src/main/ai.ts`.

The app does not call AI during process refresh. The only AI path is user initiated: click `AI Explain` for the selected process.

Before sending the command string to the configured AI endpoint, the main process redacts common secret-bearing arguments and environment-style values. The local UI may still show the raw command because it is not leaving the machine.

The model is asked to return strict JSON with:

- `summary`
- `activity`
- `resourceReason`
- `safeToQuit`
- `riskLevel`
- `recommendedAction`

The parser accepts fenced JSON, nested JSON, and plain text fallback. The UI should never show raw model JSON as the explanation summary.

## Storage

Settings are stored in Electron's `app.getPath('userData')` directory as `settings.json`.

Saved:

- base URL
- model
- refresh interval
- theme
- remember-key preference
- encrypted API key, only when enabled and supported

Not saved:

- process snapshots
- process history
- network history
- AI responses
- termination history

## Renderer safety

The renderer has `contextIsolation: true` and `nodeIntegration: false`.

Only the typed API in `src/preload/index.ts` is exposed. Renderer code cannot directly import Node APIs.

External URL opening is restricted to local HTTP URLs for service links:

```text
localhost
127.0.0.1
[::1]
0.0.0.0
```

## Current constraints

- macOS only.
- Packaging currently targets Apple Silicon.
- Network speed is derived from `nettop` samples and may show "measuring" or "unavailable" when macOS does not provide a clean sample.
- This is a process explainability tool, not an antivirus scanner.
