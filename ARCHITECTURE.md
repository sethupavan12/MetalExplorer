# Architecture

MetalExplorer is an Electron app with a strict split between OS access (main), the IPC bridge (preload), and UI (renderer).

```text
src/main
  index.ts          window, native menu, IPC handlers, menu bar monitor, window state
  sampler.ts        stateful sampler: runs the macOS tools, owns history and deltas, guarded stops
  processes.ts      ps/lsof/nettop parsing, classification, per-sample CPU and network rates
  agents.ts         coding agent session detection, process tree aggregation, terminal host detection
  agent-catalog.ts  known coding agent CLIs and exact-match detection
  agent-usage.ts    opt-in token usage reader for Claude Code and Codex local files
  system.ts         vm_stat and sysctl parsing (memory used, pressure, swap)
  settings.ts       settings.json and API key storage
  ai.ts             OpenAI-compatible explanation calls, redaction, JSON normalization
  url-guards.ts     local-only URL allow list

src/preload
  index.ts          typed contextBridge API (sandboxed, CommonJS)

src/renderer
  App.tsx           app shell: sampling loop, navigation, selection, commands, sheets
  lib/              model (filters, rules, findings, tree), formatting, preferences
  components/       DataTable (virtualized), Sparkline, CommandPalette, StopSheet, UI primitives
  views/            Overview, Agents, process tables, inspectors, Settings
  styles.css        macOS design tokens and themes

src/shared
  types.ts          contracts between main, preload, and renderer
```

## Sampling

The renderer asks for a snapshot on a timer (1 to 10 seconds, default 3). Polling pauses while the window is hidden.

`Sampler.sample()` coalesces concurrent callers (renderer, menu bar monitor, startup prime) into one run of:

- `/bin/ps -axo pid,ppid,user,pcpu,pmem,rss,vsz,etime,time,state,tty,args` and `/bin/ps -axo pid,comm`
- `/usr/sbin/lsof` for listening ports and established TCP connections
- `/usr/bin/nettop` for cumulative per-process network bytes
- `/usr/bin/vm_stat` and `/usr/sbin/sysctl` for memory, pressure, and swap

CPU percent is measured, not estimated: the sampler keeps each process's cumulative CPU time and divides the delta by the wall-clock interval, the same method Activity Monitor uses. The first sample for a process falls back to the `ps` average. Network rates use the same delta approach on `nettop` byte counters. Per-PID state is pruned when a process exits, and a start-time key guards against PID reuse.

History for charts (system, per process, per agent session) lives in memory in ring buffers of 60 to 120 samples. Nothing is written to disk.

## Classification

`classifyProcess` is local and evidence-based. It matches exact executable names, app bundle names (`/Applications/Foo.app/...`), script paths under `node_modules`, and command tokens. It deliberately avoids substring matching, which used to classify `AMPDeviceDiscoveryAgent` as an agent or `knowledge-edge` as a browser.

Categories: macOS system (root, `_` system accounts, protected paths), coding agents, databases, local model runtimes, MCP servers, dev servers, developer tools, browsers, app bundles, unknown listeners, and other user processes.

Cleanup candidates need positive evidence: an MCP server or dev tool whose parent exited (reparented to launchd for at least 10 minutes), a dev server still listening, or a background dev process busy for over 30 minutes. Live coding agent sessions and apps are never cleanup candidates.

## Coding agent sessions

`findAgentRoots` finds top-level agent processes using `agent-catalog.ts`. An agent started by another agent belongs to the outer session. `buildAgentSessions` then:

- walks each root's descendants to sum CPU, memory, network, ports, and process count
- tracks CPU time including children that already exited
- walks ancestors to find the terminal app bundle and any multiplexer (tmux, zellij, screen, herdr)
- resolves the working directory with `lsof -d cwd` (cached for 15 seconds)
- sets status from Claude Code's own state file when insights are on, otherwise from recent CPU and transcript activity

`AgentUsageReader` (opt-in) reads Claude Code transcripts incrementally from the last byte offset, so a long session is parsed once and then only appended lines are read. Codex rollouts are cumulative, so only the tail is read. Both extract usage numbers, model, branch, and timestamps only.

## Termination boundary

All stops go through `Sampler.terminate(pids)`:

- The review sheet freezes the processes it shows. The renderer sends each one's PID, command, and start time (the identity the user approved), never a bare PID.
- A fresh `ps` lookup must match that approved identity (same command, start time within 3 seconds). Otherwise the PID was reused and nothing is sent.
- The latest sample must also match it, and must mark the process as stoppable.
- The reviewed process must be marked safe to terminate, owned by the current user, and not MetalExplorer or Electron.

Only `SIGTERM` is sent. There is no `SIGKILL` path.

## AI boundary

AI calls live in `src/main/ai.ts` and run only when the user clicks Explain. The renderer sends a PID; the main process looks up that process in its own latest sample and redacts secret-looking command arguments (including the command preview) before the request. Requests time out after 45 seconds.

## Renderer safety

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- Only the typed API in `src/preload/index.ts` is exposed.
- IPC handlers validate every argument (PIDs, session ids, settings fields).
- The CSP allows no remote scripts or connections; the renderer never makes network requests.
- Navigation away from the app is blocked. External links are limited to local HTTP service URLs:

```text
localhost
127.0.0.1
[::1]
0.0.0.0
```

## Storage

`settings.json` and `window-state.json` in `app.getPath('userData')`, both mode `0600`. Settings are cached in memory and written only when changed. The renderer keeps view preferences and user rules in local storage. See [Safety and Privacy](docs/SAFETY_AND_PRIVACY.md) for the full list.

## Testing

- `npm test` runs Vitest suites for parsing, classification, CPU deltas, agent detection, session aggregation, and usage parsing with fixture files.
- `npm run visual:smoke` renders every view in Light, Dark, and Matrix with deterministic mock data (`scripts/mock-preload.cjs`), checks layout invariants (no horizontal page scroll, no `undefined`/`NaN`, title contrast), and writes screenshots to `release/visual/`.

## Current constraints

- macOS only. Packaging targets Apple Silicon first.
- Network rates depend on `nettop` and may show "Measuring" on the first sample.
- `lsof` only reports sockets for the current user's processes without admin rights.
- This is a process explainability tool, not an antivirus scanner.
