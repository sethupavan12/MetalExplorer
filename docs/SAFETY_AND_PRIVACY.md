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
- No process history saved.
- No network history saved.
- Termination is guarded and uses `SIGTERM`.

## What MetalExplorer reads

MetalExplorer reads local macOS process and network state using standard tools:

```text
/bin/ps
/usr/sbin/lsof
/usr/bin/nettop
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
- save process snapshots to disk
- upload process data automatically

## Local storage

Settings are stored in Electron's user data directory as `settings.json`.

Saved:

- AI base URL
- AI model
- refresh interval
- theme
- remember-key preference
- encrypted API key, only if explicitly enabled

Not saved:

- process history
- process command history
- network history
- AI responses
- search history
- termination history

## API keys

API keys are memory-only by default.

If "Remember key locally" is enabled, MetalExplorer uses Electron `safeStorage` when encryption is available on the machine. If encryption is unavailable, the app does not write the remembered key.

Important: anyone with access to your unlocked macOS user account may still be able to use the app while it is open.

## AI explanations

AI explanations are optional.

MetalExplorer sends process details to the configured AI endpoint only when you click `AI Explain`.

The payload can include:

- process name
- PID and parent PID
- user
- CPU and memory usage
- uptime
- ports
- local category
- local description
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
- review the command field before clicking `AI Explain`
- prefer local or self-hosted OpenAI-compatible endpoints when needed

## Network view

The Network view lists processes with established internet TCP connections.

The UI intentionally summarizes remote services instead of showing raw remote addresses in primary rows. The goal is to help users understand activity without flooding the UI with low-level endpoint data.

Network speed is estimated from `nettop` byte samples. macOS may return incomplete data, so the UI can show:

- actual upload/download rates
- measuring
- unavailable

## Termination behavior

MetalExplorer uses `SIGTERM`.

It does not use `SIGKILL`.

Before terminating, the app refreshes process state and checks:

- PID is valid and greater than 1
- process still exists
- process is owned by the current macOS user
- process is not MetalExplorer
- process is not root-owned
- process is not a protected macOS system path
- local classifier marks it as safe to terminate

The UI also requires confirmation for selected-process termination.

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
- background daemon
- login item
- new external network request
- stronger termination signal
- broader termination permissions

If the safety docs and code disagree, treat it as a bug.
