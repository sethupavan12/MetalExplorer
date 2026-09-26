# MetalExplorer Next Release Notes

## Highlights

- Redesigned as a native-feeling Mac app: sidebar vibrancy, unified toolbar, SF system fonts, dense Activity Monitor-style tables, an inspector, review sheets, and a ⌘K command palette. Themes: System, Light, Dark, Matrix.
- New Agents view for coding agent terminals: Claude Code, Codex, OpenCode, Gemini CLI, Aider, Amp, Goose, Crush, Qwen Code, Cursor Agent, Copilot CLI, Factory Droid, and Kiro CLI.
- Per-session compute for the whole process tree: CPU, memory, CPU time including exited children, processes, ports, network, and live charts.
- Terminal host and multiplexer detection, working folder, tty, and actions to bring the terminal forward, open the folder, copy the resume command, or stop the session.
- Opt-in session insights: tokens, model, context size, branch, and exact working/needs-input status from Claude Code and Codex local files.
- Accurate CPU measured from CPU time deltas, memory used/pressure/swap, load average, and network throughput with history charts.
- Process tree view, orphan detection, and a cleanup queue that never includes live sessions or apps.
- Optional menu bar monitor.

## Fixes

- CPU percent now reflects the last interval instead of the decayed `ps` average.
- App names with spaces (for example Google Chrome) are no longer truncated to their first word.
- Substring matching no longer misclassifies processes (`AMPDeviceDiscoveryAgent` as an agent, names containing "arc" or "edge" as browsers, paths containing "/go" as Go).
- Processes owned by `_` system accounts are treated as macOS system processes.
- Coding agent sessions are no longer suggested as cleanup candidates.
- Stopping a process now verifies it is still the same process, preventing a signal to a reused PID.
- The AI request no longer includes an unredacted command preview, and has a timeout.
- Per-process sampler state is pruned when processes exit (previously grew without bound).
- Settings are cached instead of re-read from disk on every call.
- Listening ports bound on both IPv4 and IPv6 report the most exposed address.
- Polling pauses while the window is hidden.

## Safety Notes

- The preload is now sandboxed, the CSP no longer allows remote connections, and IPC arguments are validated in the main process.
- Per-process resource trends are no longer written to local storage; existing trend data is deleted on first launch. Charts are memory-only.
- Session insights are off by default and read usage numbers only.
- Termination still sends `SIGTERM` only and still refuses root, system, and other users' processes.

## Known Limitations

- Token usage is available for Claude Code and Codex; other agents show process-level compute only.
- Status for agents other than Claude Code is estimated from activity.
- Packaged local builds are ad-hoc signed unless release signing and notarization credentials are configured.
