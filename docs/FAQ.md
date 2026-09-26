# FAQ

## Is MetalExplorer an antivirus app?

No.

MetalExplorer is a process explainability tool. It helps you see local servers, AI agents, internet-connected processes, and cleanup candidates. It can highlight suspicious signals, but it does not scan binaries, inspect packets, or prove that something is malware.

## Does MetalExplorer send my process list anywhere?

No automatic upload.

The app reads local process data and keeps snapshots in memory. It sends selected process details only when you click `Explain`.

## Can AI explanations leak secrets?

MetalExplorer redacts common secret patterns first, but unusual formats can slip through if another process puts secrets in command-line arguments and you click `Explain` for it.

Review the command field before using AI explanations on sensitive machines.

## Which coding agents does it detect?

Claude Code, Codex, OpenCode, Gemini CLI, Aider, Amp, Goose, Crush, Qwen Code, Cursor Agent, Copilot CLI, Factory Droid, and Kiro CLI. Detection uses exact executable names and package paths, so a process has to actually be the agent CLI.

## Does MetalExplorer read my agent conversations?

No. With session insights turned on, it reads Claude Code and Codex session files only to extract token counts, model names, branch names, timestamps, and status. Prompts, replies, and tool output are skipped and never stored or sent. Without session insights, the Agents view uses process data only.

## Why is a session "Needs input"?

For Claude Code with session insights on, the status comes from Claude Code itself. For other agents, MetalExplorer estimates status from recent CPU use and transcript activity, so treat it as a hint.

## Why does upload/download sometimes show "measuring" or "unavailable"?

MetalExplorer estimates speed from `nettop` byte samples. macOS does not always provide a usable sample for every process on every refresh.

## What happens when I terminate a process?

MetalExplorer sends `SIGTERM` after checking that the process is owned by the current user and not obviously protected.

It does not send `SIGKILL`.

## Can stopping a process lose work?

Yes.

"Safe to terminate" means "not obviously protected and owned by you." It does not mean the process has no unsaved state. Review databases, editors, browser helpers, terminals, and long-running jobs carefully.

## Why Electron instead of native Swift?

The first version optimizes for iteration speed, a polished dense UI, and easy open-source contribution from web developers. The safety boundary still keeps OS access in the Electron main process and exposes a narrow typed preload API.

Native Swift could be a future direction if performance, energy use, or platform integration becomes the main bottleneck.

## Does it run on Intel Macs?

The local package script currently builds Apple Silicon by default. The release workflow and `dist:mac` script are prepared for arm64 and x64 artifacts.

Public Intel support should be tested on an Intel Mac before it is advertised as stable.
