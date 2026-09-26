# Safety and Privacy

MetalExplorer exists because modern local development has become opaque. The app is useful only if users can trust what it reads, what it stores, what it sends, and what it can stop.

This document is the safety contract.

## Short version

- Local-first by default.
- No account.
- No telemetry.
- No daemon.
- No kernel extension.
- No admin privileges.
- No automatic AI calls.
- No process snapshots or process history saved to disk.
- No remote-destination history saved.
- Coding agent session insights are opt-in and read numbers only.
- Termination is guarded and uses `SIGTERM`.

## What MetalExplorer reads

MetalExplorer reads local macOS process and network state using standard tools:

```text
/bin/ps
/usr/sbin/lsof
/usr/bin/nettop
/usr/bin/vm_stat
/usr/sbin/sysctl   (kern.memorystatus_vm_pressure_level, vm.swapusage)
```

It reads:

- process name
- PID and parent PID
- process owner
- CPU and memory usage
- uptime
- command path and arguments
- listening TCP ports
- established internet TCP connections
- network byte samples when `nettop` provides them
- cumulative CPU time and controlling terminal (tty) for each process
- the working directory of detected coding agent processes (`lsof -d cwd`), so sessions can show their folder
- system memory statistics, memory pressure, and swap use
- local classification evidence and launch/provenance signals derived from the same process data

## Coding agent session insights

The Agents view works without reading any agent files. It groups each agent's process tree and shows CPU, memory, CPU time, processes, ports, terminal, and folder from the process data above.

"Session insights" is off by default. When you turn it on in Settings, MetalExplorer also reads files that coding agents already write on this Mac:

- `~/.claude/sessions/<pid>.json` for a running Claude Code process: session id, working directory, session name, and busy/idle status. Other fields are ignored.
- `~/.claude/projects/<folder>/<session>.jsonl`: token usage numbers, model name, git branch, and timestamps from assistant messages.
- `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`: session id, working directory, model name, cumulative token counts, context window, and timestamps.

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` are respected when set.

MetalExplorer does not keep prompts, replies, tool output, or file contents from these files. Lines are parsed only to extract the numeric usage fields and names listed above, and results stay in memory. Nothing is written back to these files, and nothing is sent anywhere.

## What MetalExplorer does not do

MetalExplorer does not:

- install a background daemon
- install a launch agent
- install a browser extension
- install a kernel extension
- install a network proxy
- modify firewall settings
- request admin permissions
- packet-sniff network traffic
- read file contents from your projects
- read prompts or replies from coding agent transcripts
- save process snapshots or process history to disk
- upload process data automatically

## Local storage

Settings are stored in Electron's user data directory as `settings.json`.

Saved:

- AI base URL
- AI model
- refresh interval
- theme
- remember-key preference
- session insights and menu bar monitor preferences
- encrypted API key, only if explicitly enabled

Window size and position are stored in `window-state.json` in the same directory.

Not saved:

- process command history
- full process snapshots
- remote network destination history
- AI responses
- search history
- termination history

Renderer-local preferences are stored in browser local storage for the current macOS user.

Saved locally:

- last open view, sort order, and list or tree layout
- sidebar and inspector visibility
- user process rules such as "always keep" and "always flag", and the rule profile

The charts in the app (system CPU, memory, network, per-process and per-session history) are kept in memory for the last few minutes and are dropped when the app quits. Earlier versions stored 24 hours of per-process resource trends in local storage; the current version deletes that data on first launch.

The Settings screen includes a control to reset user rules.

## API keys

API keys are memory-only by default.

If "Remember key locally" is enabled, MetalExplorer uses Electron `safeStorage` when encryption is available on the machine. If encryption is unavailable, the app does not write the remembered key.

Important: anyone with access to your unlocked macOS user account may still be able to use the app while it is open.

## AI explanations

AI explanations are optional.

MetalExplorer sends process details to the configured AI endpoint only when you click `Explain`. The main process looks up the process by PID in its own latest sample, so the renderer cannot change what is sent.

The payload can include:

- process name
- PID and parent PID
- user
- CPU and memory usage
- uptime
- ports
- local category
- local description
- classification confidence and evidence
- local launch/provenance metadata
- local service/project grouping
- command path and arguments, with common secret-looking values redacted
- local safe-termination flag

## Important warning about command arguments

Some tools put secrets in command-line arguments. Bad practice, but common enough to matter.

Examples:

```text
node server.js --token=...
python script.py --api-key=...
curl -H Authorization:...
```

If a process command contains a secret, that secret can appear in MetalExplorer because the process table is local and read-only. Before an AI request, MetalExplorer redacts common secret-bearing command patterns such as `--api-key`, `--token`, `Authorization: Bearer`, `OPENAI_API_KEY=...`, `PASSWORD=...`, and similar values.

This is a safety layer, not a guarantee. Unusual secret formats may not be recognized.

For sensitive machines:

- avoid AI explanations unless you trust the endpoint
- review the command field before clicking `Explain`
- prefer local or self-hosted OpenAI-compatible endpoints when needed

## Network view

The Network view lists processes with established internet TCP connections.

The UI shows remote address, remote port, service label, direction, remote scope, and likely encryption status for active connections. MetalExplorer does not packet-sniff traffic or persist remote destination history.

Network speed is estimated from `nettop` byte samples. macOS may return incomplete data, so the UI can show:

- actual upload/download rates
- measuring
- unavailable

## Termination behavior

MetalExplorer uses `SIGTERM`.

It does not use `SIGKILL`.

Before terminating, the app checks the live process against the one you reviewed:

- PID is valid and greater than 1
- PID was in the reviewed sample
- process still exists
- it is still the same process (same command, same owner, not restarted), so a reused PID is never signalled
- process is owned by the current macOS user
- process is not MetalExplorer
- process is not root-owned
- process is not a protected macOS system path
- local classifier marks it as safe to terminate

The UI requires confirmation in a review sheet for every stop, including cleanup batches and coding agent sessions. Stopping a coding agent session sends `SIGTERM` to the agent process only; its children usually exit with it.

## Other local actions

- "Show in <terminal>" runs `/usr/bin/open -a` on the terminal app bundle that hosts a session.
- "Open Folder" opens a session's working directory in Finder.
- "Copy" actions write to the macOS clipboard.
- The menu bar monitor, when enabled, samples processes on the same interval while MetalExplorer is running. It does not start at login.

## Classification reports

The inspector can export a classification report for a selected process when the user explicitly clicks export.

The report is a local JSON file written to the path the user chooses in the macOS save dialog. It includes the selected process classification, evidence, provenance, ports, resource use, and summarized active network connections. Command arguments are redacted with the same redaction path used before AI explanations.

Classification reports are not uploaded by MetalExplorer.

## What "safe to terminate" means

"Safe to terminate" means MetalExplorer believes macOS will allow the current user to send `SIGTERM` and the process is not obviously protected.

It does not mean:

- the process is useless
- the process is malware
- no unsaved work can be lost
- termination has no side effects

For databases, editors, browser helpers, and long-running jobs, review context before stopping anything.

## Malware claims

MetalExplorer is not an antivirus scanner.

It can surface suspicious signals:

- unknown process
- listening local port
- internet connection
- high CPU
- long uptime
- unclear command path

It should not claim malware without evidence.

## Maintainer rules

Any future feature that adds one of the following must update this document before release:

- telemetry
- update checks
- crash reporting
- process history
- network history
- automatic AI calls
- reading new agent or application files
- background daemon
- login item
- new external network request
- stronger termination signal
- broader termination permissions

If the safety docs and code disagree, treat it as a bug.
