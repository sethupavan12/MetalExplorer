# Changelog

All notable changes will be documented here.

This project follows a simple pre-1.0 changelog. Dates use `YYYY-MM-DD`.

## Unreleased

### Added

- macOS Electron app shell with Dashboard, Processes, Services, Agents, Cleanup, Network, and Settings views.
- Local process classification for system services, local servers, AI agents, developer tools, databases, browsers, user apps, and unknown listeners.
- Network process view with upload and download estimates from `nettop`.
- Guarded process termination with `SIGTERM`.
- Optional OpenAI-compatible AI explanations.
- Theme support for Light, Graphite Dark, and Matrix.
- Resizable panes, collapsible sidebar, and collapsible table filters.
- Visual smoke tests for scroll behavior, theme contrast, app shell mounting, and filter visibility.

### Security

- API key is memory-only by default.
- Remembered API keys use Electron `safeStorage` when available.
- AI calls happen only on explicit `AI Explain`.
- External service opener is restricted to local HTTP URLs.
