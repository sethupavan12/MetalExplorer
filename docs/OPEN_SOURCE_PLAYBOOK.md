# Open Source Launch Playbook

Goal: maximize useful stars without resorting to gimmicks.

Stars follow from a clear problem, a strong first impression, trust, easy installation, and visible maintenance. MetalExplorer has the problem. The repo needs to make that obvious in 20 seconds.

## Repos reviewed

Current GitHub metadata checked on 2026-05-11:

| Project | Stars | What to copy |
| --- | ---: | --- |
| [IINA](https://github.com/iina/iina) | 44.8k | One-line positioning, website/release links, contribution guidance, plugin/community surface |
| [Stats](https://github.com/exelban/stats) | 38.7k | Screenshot-first README, Homebrew/manual install, practical FAQ, external API transparency |
| [MonitorControl](https://github.com/MonitorControl/MonitorControl) | 33.2k | Clear value prop, warning block, screenshot, build dependencies, credits |
| [Rectangle](https://github.com/rxhanson/Rectangle) | 29k | Simple install flow, system requirements, usage guide, code of conduct, contributing docs |
| [Ice](https://github.com/jordanbaird/Ice) | 27.9k | Feature gallery, macOS requirement explanation |
| [AltTab](https://github.com/lwouis/alt-tab-macos) | 15.6k | Screenshot-first README, website/download stats, docs folder, test folder, agent docs |

## Patterns that matter

### 1. First viewport sells the product

The README needs:

- app name
- one-line promise
- badges
- screenshot
- why it exists
- install command

MetalExplorer now follows this.

### 2. Trust is part of the product

System utilities need explicit safety docs. Stats documents external API calls. MonitorControl explains hardware protocols and warnings. MetalExplorer should be even more explicit because it handles process termination and optional AI.

Required trust docs:

- `docs/SAFETY_AND_PRIVACY.md`
- `SECURITY.md`
- `ARCHITECTURE.md`

### 3. Installation must be low friction

Launch state:

- local build instructions are ready
- signed releases are not ready
- Homebrew cask is not ready

For a broader launch, ship:

- signed `.dmg`
- signed `.zip`
- checksums
- Homebrew cask
- release notes

### 4. Contribution path must protect the maintainer

High-star apps get repetitive issues. The repo needs templates before traffic arrives.

Added:

- bug report template
- feature request template
- pull request template
- contributing guide
- code of conduct

### 5. The project needs a safety moat

MetalExplorer should be known as the tool that is transparent about process data.

Do not add:

- silent telemetry
- automatic AI
- undisclosed update checks
- process history by default
- broad kill switches

Do add:

- clear docs
- tests for guard rails
- visible release notes
- reproducible build steps

## Launch checklist

Before posting publicly:

1. Create a clean GitHub repository.
2. Set repository description:

   ```text
   macOS task manager for local dev servers, AI agents, MCP servers, and internet-connected processes.
   ```

3. Add topics:

   ```text
   macos, electron, task-manager, process-monitor, network-monitor, local-first, ai, agents, mcp, developer-tools
   ```

4. Enable GitHub Discussions.
5. Enable private vulnerability reporting.
6. Add repository social preview image from `docs/assets/social-preview.svg`.
7. Publish signed release artifacts.
8. Add Homebrew cask after first signed release.
9. Pin a launch issue for roadmap and known limitations.

## Launch copy

Short:

```text
MetalExplorer is a macOS task manager for the agent era. It shows local dev servers, AI agents, MCP tools, cleanup candidates, and internet-connected processes in one readable UI.
```

Long:

```text
I built MetalExplorer because local development has changed. It is no longer one terminal running one dev server. AI tools, MCP servers, package scripts, databases, and browser helpers can all stay alive in the background. MetalExplorer makes that visible, explains what each process likely does, and lets you safely clean up user-owned processes you no longer need.
```

## README sections to keep near the top

1. Screenshot
2. Why this exists
3. Highlights
4. Safety model
5. Install
6. Development

Do not bury safety. For this app, safety is part of the pitch.
