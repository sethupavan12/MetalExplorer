# FAQ

## Is MetalExplorer an antivirus app?

No.

MetalExplorer is a process explainability tool. It helps you see local servers, AI agents, internet-connected processes, and cleanup candidates. It can highlight suspicious signals, but it does not scan binaries, inspect packets, or prove that something is malware.

## Does MetalExplorer send my process list anywhere?

No automatic upload.

The app reads local process data and keeps snapshots in memory. It sends selected process details only when you click `AI Explain`.

## Can AI explanations leak secrets?

They can if another process includes secrets in command-line arguments and you click `AI Explain` for that process.

Review the command field before using AI explanations on sensitive machines.

## Why does Network show service names instead of remote IPs?

Primary rows summarize remote ports as services like HTTPS, HTTP, DNS, SSH, or TCP port labels. Raw endpoint noise makes the UI harder to scan and can overflow table cells.

Future versions can add an advanced details toggle for users who need raw endpoints.

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
