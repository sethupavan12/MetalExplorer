# Roadmap

This is the public direction, not a promise.

## Where MetalExplorer is going

Most people who open Activity Monitor today are not hunting a runaway Safari tab. They are running three coding agents in three terminals, each of which started a dev server, a test watcher, and a handful of MCP servers. Some of those finished an hour ago and left their children behind.

MetalExplorer's job is to make that machine legible:

1. **Agents first.** Every coding agent session is a first-class object with its own compute, tokens, status, and process tree.
2. **Explain, then act.** Every flag comes with evidence. Every stop goes through a review sheet.
3. **Local by default.** Nothing leaves the Mac unless you press a button that says so.
4. **Feel like it shipped with macOS.** Native materials, keyboard-first, dense where it matters.

## Shipped in the native redesign

- Agents view: Claude Code, Codex, OpenCode, Gemini CLI, Aider, Amp, Goose, Crush, Qwen Code, Cursor Agent, Copilot CLI, Factory Droid, and Kiro CLI sessions in one place.
- Per-session compute: CPU and memory for the whole process tree, CPU time including exited children, process count, ports it opened, and network traffic.
- Terminal host detection (WezTerm, iTerm2, Terminal, Ghostty, VS Code, Cursor, and others) plus tmux, zellij, screen, and herdr multiplexers.
- Opt-in session insights: tokens, model, context size, branch, and exact working/needs-input status from the counters Claude Code and Codex keep locally.
- Session actions: bring the terminal forward, open the folder, copy the resume command, stop the session with a review sheet.
- Accurate CPU: measured from cumulative CPU time between samples, the way Activity Monitor does it.
- System gauges: CPU, memory used (app + wired + compressed), memory pressure, swap, load average, network throughput, with in-memory history charts.
- Process tree view, virtualized tables, keyboard navigation, command palette (⌘K), native menu with shortcuts.
- Orphan detection: MCP servers, dev servers, and build tools whose parent exited are the cleanup queue. Live coding sessions never are.
- Stop hardening: PID reuse check before every signal, batched stops, AI and exports resolved by PID in the main process.
- System, Light, Dark, and Matrix themes. Sidebar vibrancy. Optional menu bar monitor.
- Opt-in "needs your input" notifications when a session finishes its turn.

## Next: 0.5 "Sessions you can trust"

- Codex and Claude session matching from session files for every agent that publishes one (OpenCode's SQLite store, Gemini CLI checkpoints).
- Token rate and cost estimate per session with a user-supplied price table. Numbers only, no network lookups.
- Needs-input detection for agents beyond Claude Code, and an optional "session ended" notification.
- Budget guardrails: warn when a session crosses a CPU-time or token threshold you set.
- Group view: all sessions in one repository side by side, including worktrees.
- Stop session tree: offer to stop descendants that survive the agent.

## 0.6 "Explain everything locally"

- Local model explanations through Ollama, LM Studio, or any OpenAI-compatible localhost endpoint, preconfigured and detected.
- LaunchAgent and login item inspector: what starts at login and who installed it.
- Port conflict helper: "port 3000 is taken by X, started by session Y".
- Energy impact column, once there is a way to read it without admin rights or a privileged helper.
- Accessibility pass with VoiceOver labels for every chart.

## 1.0 "Ships like a Mac app"

- Signed and notarized universal builds, Homebrew cask, Sparkle update feed with an opt-in check.
- Widgets for Notification Center: working agents and CPU.
- Native menu bar extra with a compact agent list (replacing the title-only tray).
- Shortcuts app actions: list sessions, stop session, open folder.

## Later

- Optional session timeline kept on disk with an explicit retention setting (off by default).
- Remote Macs over SSH, read-only.
- Plugin rules for teams that want to mark internal tools as known.

## Non-goals

- Malware verdicts without evidence.
- Silent telemetry.
- Automatic AI calls.
- Reading prompts or replies from agent transcripts.
- Packet capture.
- Root process termination or `SIGKILL`.
- A background daemon by default.
