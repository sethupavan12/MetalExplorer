# MetalExplorer MVP Design

## Product Goal

MetalExplorer is a macOS-only, local-first task manager for people running many AI, dev, and agentic services. The first version makes process state understandable at a glance, highlights local servers and agent tools, and lets the user safely terminate processes they own.

## Target User

The primary user is a vibe-coding developer or technical beginner who has local tools running across many terminals, packages, model servers, MCP servers, and browser-based development services. They need to answer four questions quickly:

- What is running right now?
- Which processes are normal system services, dev tools, AI agents, or unknown?
- Which processes are exposing local ports?
- Can I stop this without damaging the system or my work?

## Scope

The MVP ships as an Electron desktop app with a React UI and a local Node/Electron main process. It does not require login or a backend service. It reads macOS process and listening-port data using local commands, classifies processes with deterministic local heuristics, and optionally uses an OpenAI-compatible Chat Completions endpoint for deeper explanations.

The app stores only local user preferences. It does not upload process data unless the user explicitly asks for AI explanation or uses the AI batch explanation control. API keys are kept in memory by default. If the user enables "remember key", the key is encrypted with Electron safeStorage where available and saved in the app user-data directory.

## Features

### Process Table

The main view is a dense, scan-friendly process table with columns for process name, local description, category, CPU, memory, ports, PID, user, uptime, and status. Rows are sortable and filterable. Local descriptions are visible without clicking and are generated from a built-in ruleset, not from AI calls.

### Process Inspector

Selecting a process opens a side inspector with command path, arguments, parent PID, resource impact, listening ports, uptime, category, and action guidance. The user can request an AI explanation for the selected process. The AI response is structured into "what it is", "what it appears to be doing", "why it may be using resources", "safe to quit", "risk level", and "next step".

### Dashboard

The dashboard summarizes running processes, CPU-heavy processes, high-memory processes, detected local servers, AI/agent tools, package-manager services, and unknown network listeners. It includes a "clean candidates" section that lists user-owned dev or agent services that are likely safe to terminate.

### Settings

Settings let the user configure:

- OpenAI-compatible base URL, defaulting to `https://api.openai.com/v1`.
- Model name, defaulting to a configurable text value.
- API key.
- Whether to remember the key locally.
- Refresh interval.

### Termination

The MVP supports guarded SIGTERM for user-owned processes only. It blocks termination for PID 0, PID 1, the current Electron process, root-owned processes, and obvious macOS system paths. Force kill is intentionally out of scope for the first version.

## Architecture

### Electron Main Process

The main process owns all OS access and sensitive settings. It exposes a narrow IPC API to the renderer:

- `processes:list` returns a process snapshot.
- `processes:terminate` sends guarded SIGTERM.
- `ai:explain` sends selected process context to the configured AI endpoint.
- `settings:get` and `settings:update` manage local settings.

### Process Collector

The collector calls `/bin/ps` for process metadata and `/usr/sbin/lsof` for listening TCP ports. Parsing is isolated in pure functions with unit tests. Process classification is also pure and deterministic, which keeps the UI useful without an API key.

### Renderer

The renderer is a React app with a left rail, dashboard strip, process table, and inspector panel. It never touches Node APIs directly. It calls the typed preload bridge exposed by Electron.

## Visual Direction

The UI should feel like a modern operations console rather than Activity Monitor or Windows Explorer. The aesthetic is "signal desk": dense information, precise typography, dark graphite surfaces, pale data ink, cyan and amber signal accents, and risk colors used sparingly. It avoids decorative hero screens, marketing copy, gradient blobs, and oversized cards. The first screen is the working task manager.

## Data And Privacy

Saved locally:

- Base URL.
- Model name.
- Refresh interval.
- Whether API key persistence is enabled.
- Encrypted API key only when enabled and Electron safeStorage is available.

Not saved:

- Process snapshots.
- AI responses.
- User interaction history.
- Termination history.

Uploaded only on explicit AI action:

- Selected process name, PID, user, CPU, memory, uptime, ports, category, local description, command path, and arguments.

## Testing Strategy

Unit tests cover parsing of `ps`, parsing of `lsof`, elapsed-time parsing, process classification, summary derivation, and AI response parsing. Build verification checks TypeScript and Electron/Vite bundling. Manual verification covers process table rendering, settings entry, AI error handling without a key, and guarded termination behavior.

## Out Of Scope For MVP

- Login, accounts, cloud sync, or hosted backend.
- Kernel extensions or privileged helpers.
- Packet inspection, file-system modification, or network blocking.
- Force kill.
- Cross-platform support.
- Persistent process history and trend charts.
