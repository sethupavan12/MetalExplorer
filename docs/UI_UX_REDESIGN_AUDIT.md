# MetalExplorer UI/UX Redesign Audit

Generated on 2026-05-12 after a five-agent parallel design review of the current light-theme screenshots.

Screens reviewed:

- `release/visual-smoke-dashboard.png`
- `release/visual-smoke-processes.png`
- `release/visual-smoke-services.png`
- `release/visual-smoke-cleanup.png`
- `release/visual-smoke-network.png`
- `release/visual-smoke-settings.png`

## Executive Read

The five reviews strongly agree on the core problem: MetalExplorer has the correct product architecture, but it still feels like a web dashboard inside Electron rather than a first-class macOS utility.

The winning direction is not more decorative polish. It is a more native, denser, calmer utility model:

- Left pane: macOS source list with subdued counts and saved scopes.
- Center pane: table-first work area with native toolbar controls.
- Right pane: true inspector with evidence, confidence, and guarded actions.
- Dashboard: health briefing that routes into filtered tables, not a KPI-card landing page.
- Cleanup and Network: safety-first workflows with reasons, destinations, and confirmation.

The app should feel closer to Activity Monitor, Finder inspector, System Settings, and Xcode Instruments than to Linear, a SaaS dashboard, or a web admin panel.

## Design Direction 1: Native Mac Inspector Console

Source lens: macOS Finder + System Settings.

### Visual Thesis

MetalExplorer should feel less like a web admin dashboard and more like a serious macOS utility: Finder source list on the left, dense native table in the center, and polished inspector on the right.

The current UI has the right structure, but too many surfaces compete for attention. Everything is boxed, rounded, shadowed, and spaced like a web app. A safety-sensitive process inspector needs calm hierarchy, native density, and immediate action clarity.

### Core Layout

- Keep the three-pane architecture.
- Use a source-list sidebar, not large pill buttons.
- Use a single content toolbar per screen.
- Make tables the primary object.
- Convert the inspector from metric cards into grouped rows.
- Reduce shadows and card usage.
- Use selection tint instead of black/strong left rails.

### Best Ideas

- Sidebar sections: Overview, Processes, Network, Preferences.
- Counts should be trailing gray badges.
- Dashboard should answer "what needs attention now?", not show six widgets.
- Inspector should have groups: Identity, Safety, Actions, Metrics, Network, Metadata.
- Settings should become System Settings-style grouped rows.

## Design Direction 2: Activity Monitor Meets Instruments

Source lens: Activity Monitor + Xcode Instruments.

### Visual Thesis

MetalExplorer should feel like a native macOS diagnostic utility: dense, quiet, sortable, status-forward, and trustworthy under pressure.

The app should make one thing obvious at all times: what is running, what is exposed, what is risky, and what can safely be stopped.

### Core Layout

- Three-pane macOS utility layout.
- Unified toolbar with title, scope/filter controls, search, refresh, and sampling status.
- Dense sortable tables with 32-40px rows where possible.
- Timeline/status panels that communicate real diagnostic meaning.
- Inspector that gives deeper evidence rather than repeating table metrics.

### Best Ideas

- Dashboard becomes a compact system overview: status bar, metric strip, mini timeline, ranked tables.
- Processes table becomes denser and more sortable.
- Services becomes ports-first.
- Network becomes connection table plus throughput graph.
- Cleanup becomes a review queue with reasons and confidence.

## Design Direction 3: Local Trust Console

Source lens: Apple security/privacy utility.

### Visual Thesis

MetalExplorer should communicate: nothing leaves this Mac unless the user asks, every judgment has evidence, termination is guarded, and uncertainty is explicit.

The current UI is clean but too noisy, too card-heavy, and too confident where it should be careful. It looks like a process monitor with AI buttons bolted on. The redesign should feel like Activity Monitor + System Settings Privacy + Keychain trust language.

### Core Layout

- Make confidence first-class for every classification.
- Dashboard becomes a ranked "Needs Review" surface.
- Right inspector becomes "Evidence & Actions".
- Termination becomes staged: review, confirmation sheet, final stop.
- AI explanation remains clearly on demand.

### Best Ideas

- Replace "Unknown" with "Unknown process".
- Replace "Cleanup candidate" with "Likely safe to stop" only when evidence is visible.
- Replace "Guarded termination available" with concrete guard status.
- Add confidence levels: high, medium, low.
- Make destructive actions visually and spatially separate from exploratory actions.

## Design Direction 4: Local Control Tower

Source lens: network and agent observability.

### Visual Thesis

MetalExplorer should feel like a native macOS control surface for what is running, what is talking to the internet, and what is safe to stop.

The app has the bones of an Apple-quality utility, but the product story is buried in rows and repeated metric cards. The dashboard should become a health briefing; Network should become a traffic inspector; Cleanup should become a safe review queue.

### Core Layout

- Dashboard top band: System Health.
- Prioritized findings: unknown listener, internet processes, cleanup opportunity.
- Focused modules: Internet Activity, Exposed Local Services, Cleanup Queue.
- Network table: process, trust, remote, direction, down, up, connections, last active, action.
- Cleanup flow: select, review impact, confirmation sheet, stop.

### Best Ideas

- Dashboard inspector should default to System Summary.
- Promote unknown internet/listener processes visually.
- Show remote destination, not just protocol.
- Replace "Kill selected" with "Inspect" and "Stop..." only after selection.
- Put AI/privacy reassurance at the exact point of use.

## Design Direction 5: Mac Utility With Guarded Actions

Source lens: interaction model, panes, filters, and safety flows.

### Visual Thesis

The app has the right ingredients, but it still feels like a web dashboard wearing macOS clothes. The Apple-quality version should feel like Activity Monitor plus Network Utility plus a safety inspector: calm, dense, resizable, keyboard-friendly, with every risky action routed through inspection and confirmation.

### Core Layout

- Left: navigation and saved scopes.
- Center: canonical process/service/network table.
- Right: persistent inspector with facts, risk, network, ports, and actions.
- Dashboard routes users into filtered table states.
- Filters are visible as chips after activation.
- Empty states explain current scope and filters.

### Best Ideas

- Use one canonical table component across Processes, Services, Cleanup, and Network.
- Each navigation item applies a scope/filter and changes columns.
- Dashboard cards become actionable filtered scopes.
- Bulk termination opens a review tray, never immediate termination.
- Inspector sections: Identity, Risk, Resource Use, Network, Ports, AI Explanation, Termination.

## Consolidated Screen-By-Screen Issues

### Dashboard

Current problems:

- The dashboard is visually busy but not operationally sharp.
- It still reads like a SaaS/web dashboard rather than a local diagnostic utility.
- "Review needed" is too large for the amount of actual evidence shown.
- The evidence behind the status is scattered across cards and metric strips.
- The dashboard does not clearly rank what matters most.
- The selected inspector competes with system-level dashboard content.
- The inspector often shows one process while the dashboard is trying to summarize the whole machine.
- The connectivity history visualization is decorative and under-explained.
- The block grid does not explain time, scale, process ownership, traffic direction, or severity.
- Process, Services, Agents, and Internet metric cards duplicate sidebar counts.
- Lower cards such as High Load, Internet Processes, and Cleanup are useful but disconnected.
- The dashboard does not make unknown internet activity or unknown listeners prominent enough.
- The dashboard does not clearly route the user into the exact filtered table that needs attention.

Desired direction:

- Replace the current dashboard with a health briefing.
- Show the three most important findings first.
- Convert metrics into actionable summary rows.
- Default the right inspector to System Summary on Dashboard.
- Only show process detail in the inspector after the user selects a process.
- Use dashboard modules for Internet Activity, Exposed Local Services, and Cleanup Queue.
- Keep visualizations only if they help the user decide what to inspect.

### Processes

Current problems:

- This is structurally the strongest screen, but it still feels web-based.
- Row height is too tall for a professional process monitor.
- The table container floats like a card rather than feeling like a native table.
- Selected-row treatment is too heavy and can read like a warning.
- The black/strong left rail should not be used for normal selection.
- Summary text truncates the most important explanations.
- Repeated generic text wastes table space.
- CPU and memory bars are too faint to be useful.
- CPU and memory bars lack a clear scale.
- Search and filter controls are oversized.
- Filters are hidden behind a button, so the app's power is not visible.
- Classification badges are too pill-like and too decorative.
- Unknown processes do not feel meaningfully different from normal dev servers.
- The inspector repeats basic metrics instead of explaining why a process is flagged.

Desired direction:

- Make rows denser: roughly 40-52px depending on content.
- Use native selected-row tint, not a warning rail.
- Prefer sortable numeric columns over faint mini bars unless the bars become real meters.
- Add visible filter chips for User-owned, Listening, Internet, Unknown, AI Agent, High CPU, Cleanup.
- Keep the table as the main artifact.
- Make process classification, confidence, exposure, and actionability easier to scan.

### Services

Current problems:

- The screen is too sparse and has too much empty table space.
- It reuses the generic process table when services need different priorities.
- Ports should be first-class but are visually secondary.
- The app does not clearly answer "what is listening on my Mac?"
- Bind address, local URL, protocol, owner, and exposure are not prominent enough.
- The open-localhost icon is useful but under-explained.
- If a process exposes multiple ports, it is unclear which action opens which port.
- The empty area makes the screen feel unfinished.
- Unknown local listeners are not treated seriously enough.

Desired direction:

- Make Services port-first.
- Recommended columns: Port, Local URL, Bind Address, Protocol, Process, PID, Owner, Risk, Age, Open.
- Show `localhost:5173` or equivalent directly in the row.
- Collapse or explain empty space.
- Include evidence for unknown listeners: command, path, owner, parent process, first seen, confidence.

### Cleanup

Current problems:

- Cleanup does not feel safe enough.
- "Cleanup candidate" is a high-trust claim but reasons are not visible in rows.
- "Select all" is too aggressive for a destructive workflow.
- Bulk termination is presented too casually.
- Summary metrics sound like optimization software and risk overpromising.
- "Cleanable CPU" and "Cleanable memory" are not tied clearly to selected rows.
- Checkboxes are visually small relative to the danger of the action.
- Selected candidates do not create a strong pending-action state.
- There is no staged review tray or confirmation sheet that explains consequences.
- The user cannot see which ports or services will stop before acting.

Desired direction:

- Turn Cleanup into a safe review queue.
- Add a visible reason column.
- Add confidence/guard status for every candidate.
- Replace "Select all" with safer language or move it behind a secondary action.
- Use "Review Cleanup" as the primary flow.
- Confirmation sheet should show process names, PIDs, ports affected, network state, resource estimate, and expected consequences.
- Nothing should stop until final confirmation.

### Network

Current problems:

- The Network screen is the most underpowered relative to product promise.
- "Remote: HTTPS" is not remote. It is only protocol.
- The user needs destination host/IP, remote port, protocol, direction, connection state, and last active.
- The current table does not distinguish expected dev-tool traffic from unknown process traffic.
- Unknown internet-connected processes should stand out more.
- "Kill selected" is too blunt and dangerous.
- Network activity alone is not enough justification to kill a process.
- The inspector says there is an active internet connection but does not show where it connects.
- A single process can have multiple connections, but the UI collapses that detail too far.
- Throughput numbers are isolated from process/destination context.

Desired direction:

- Redesign Network as a traffic inspector.
- Recommended columns: Process, Trust/Kind, Remote Host/IP, Direction, Protocol, Down, Up, Connections, Last Active, Action.
- Replace "Kill selected" with "Inspect" and "Stop..." after selection.
- Show per-process destinations in the table and inspector.
- Support expanded rows or inspector detail for multiple connections.
- Add filters: All, Unknown, Internet, Localhost, Agents, High Traffic.

### Settings

Current problems:

- Settings are functional but not Mac-quality.
- The form is too large and web-like.
- Theme selection is too large for a low-frequency preference.
- "Matrix" feels playful/off-brand for a serious utility unless intentionally framed as an optional theme.
- AI provider controls need privacy copy at the point of entry.
- API key storage behavior needs clearer state.
- "Remember API key locally" is privacy-critical but visually buried.
- "Save Settings" implies staged changes, but the UI does not show dirty state or validation.
- The privacy panel is useful but disconnected from the controls.
- Refresh interval lacks user-friendly units.

Desired direction:

- Convert Settings to System Settings-style grouped rows.
- Use compact segmented controls.
- Put API key storage controls next to the API key field.
- Show: AI calls are on demand, process data is sent only when the user asks, key storage is local, history is not persisted.
- Either auto-save like native preferences or clearly show pending changes and saved state.

### Inspector

Current problems:

- The inspector is valuable but too card-heavy.
- It repeats table metrics without enough evidence or reasoning.
- "Guarded termination available" is vague.
- AI Explain and Terminate sit as equal peers.
- Destructive action is too visually close to exploratory action.
- Metric cards are too chunky.
- Section headers feel web-like and loud.
- The inspector needs to explain why a process is flagged, not just what the process is.
- On Dashboard, the inspector should not default to a random selected process.

Desired direction:

- Convert inspector to grouped native rows.
- Recommended sections:
  - Identity
  - Assessment
  - Why Flagged
  - Resource Use
  - Ports
  - Network
  - AI Explanation
  - Termination
- Make destructive actions progressive and separated.
- Rename destructive actions to "Review Termination..." until final confirmation.
- Add confidence and evidence to every classification.

## Cross-Cutting Issues

### 1. Too Many Cards

The UI overuses bordered cards, rounded boxes, and shadows. This makes the app feel like a web dashboard. Cards should only wrap true grouped content or repeated items. Tables, inspector rows, settings rows, and source lists should rely more on native separators and grouped surfaces.

### 2. Insufficient Density

The app is a utility for scanning processes. It needs more Activity Monitor density. Current rows, controls, and cards are too tall. Important lists show too few rows at once.

### 3. Weak Information Hierarchy

The UI often shows facts without ranking them. "1 high CPU", "1 unknown listener", and "2 cleanup" are facts, not a recommendation. The app needs to answer: what matters most, why, and what should the user inspect next?

### 4. Safety Language Is Too Casual

"Kill selected", "Terminate", and "Select all" are too blunt in safety-sensitive contexts. Destructive actions need staged flows and consequence previews.

### 5. Explainability Is Not Visible Enough

The product's core advantage is explainability, but explanations are often hidden in the inspector or truncated in table cells. Every recommendation needs visible evidence.

### 6. Network Detail Is Underpowered

Network currently shows protocol but not destination. This is the biggest functional UX gap. A network screen must show who is talking to the internet, where, how much, and whether it is expected.

### 7. Cleanup Claims Need Evidence

Cleanup recommendations must show visible reasons, confidence, and consequences. "Cleanable" without a reason undermines trust.

### 8. Filters Are Too Hidden

Filters should become visible chips/scopes after activation. For this product, filters are not advanced settings; they are the user's main way to understand the machine.

### 9. Inspector Should Become Evidence & Actions

The right pane should be a decision panel, not a metric card stack. It should help users decide whether to ignore, inspect, explain, open, or stop a process.

### 10. Mac-Native Styling Needs More Discipline

Apple-quality here means restraint: subtle separators, denser lists, less shadow, smaller controls, clear selection tint, grouped rows, and semantic color. It does not mean larger white cards.

## Unified Target Architecture

### Left Pane: Source List

Recommended structure:

- Dashboard
- All Processes
- Local Services
- Internet Activity
- Cleanup Candidates
- AI Agents
- Settings

Optional later:

- Saved Scopes
- Recent Reviews
- Hidden/Ignored Processes

Rules:

- Counts are subdued trailing badges.
- Selection uses macOS source-list tint.
- Collapse state should keep icons and tooltips.
- "Local first" remains a bottom trust status.

### Center Pane: Table-First Work Area

Rules:

- One canonical table model powers Processes, Services, Cleanup, and Network.
- Each navigation item applies scope-specific rows and columns.
- Toolbar stays consistent.
- Search and active filters remain visible.
- Tables support sorting.
- Future: resizable columns and persistent widths.

### Right Pane: Evidence & Actions Inspector

Rules:

- Dashboard default state: System Summary.
- Process selected state: Evidence & Actions.
- Empty state: Select a process to inspect.
- Compact grouped rows instead of cards.
- Destructive actions appear after evidence and require confirmation.

Suggested inspector sections:

- Identity: name, PID, user, path, parent.
- Assessment: category, confidence, risk.
- Why flagged: visible evidence bullets.
- Resource use: CPU, memory, uptime, network.
- Ports: local bindings and open actions.
- Network: remote destinations and rates.
- AI: on-demand explanation state.
- Termination: guard status and review button.

## Prioritized Implementation Backlog

### P0: Trust And Safety

1. Replace direct destructive actions with "Review Termination..." flows.
2. Add a confirmation sheet for termination with process name, PID, user, ports, child risk, network activity, and expected consequence.
3. Replace "Kill selected" with safer language.
4. Replace "Select all" cleanup behavior with a review queue or safer secondary action.
5. Add visible cleanup reasons and guard status to Cleanup rows.
6. Add "why flagged" evidence to the inspector.
7. Make AI on-demand privacy copy visible next to AI actions and settings.

### P1: Native Mac Utility Structure

1. Redesign inspector as grouped native rows, not metric cards.
2. Make table rows denser and more Activity Monitor-like.
3. Replace selected-row rail with native tinted selection.
4. Reduce card borders, shadows, and oversized rounded surfaces.
5. Convert Settings to grouped System Settings-style rows.
6. Make the toolbar more native and compact.
7. Add visible active filter chips.

### P2: Dashboard Redesign

1. Replace dashboard card garden with a health briefing.
2. Show top three prioritized findings.
3. Convert summary modules into clickable filtered scopes.
4. Default dashboard inspector to System Summary.
5. Remove or redesign Connectivity History into a useful timeline.
6. Promote unknown listener/internet findings above raw counts.

### P3: Network And Services

1. Show real remote destinations in Network.
2. Add protocol, direction, rates, connections, and last active.
3. Make Services port-first.
4. Show local URL and bind address in Services.
5. Add expanded detail for multiple connections or ports.
6. Add filters for Unknown, Internet, Localhost, Agents, High Traffic.

### P4: Polish And Empty States

1. Replace huge blank table areas with useful empty states.
2. Make badges smaller and more native.
3. Define or remove "Impact 42/100".
4. Clarify refresh interval units.
5. Add saved/dirty state to Settings or switch to auto-save.
6. Tighten typography weights and spacing.

## Concrete Copy Changes

Replace:

- "Unknown" with "Unknown process"
- "Cleanup candidate" with "Likely safe to stop" only when evidence is visible
- "Guarded termination available" with "Termination guard: Available"
- "Kill selected" with "Review Termination..."
- "Select all" with "Select recommended" or move behind a menu
- "AI Explain" with "Explain on demand"
- "Impact 42/100" with a defined metric or remove it
- "Remote: HTTPS" with actual remote host/IP plus protocol

## Component Rules

### Tables

- Row height target: 40-52px.
- Sticky headers.
- Numeric columns right-aligned.
- Tabular numerals for PID, CPU, memory, ports, throughput.
- Native selected-row tint.
- Sort indicators on sortable metrics.
- Summary text should not hide the critical part of the explanation.

### Badges

- Smaller, quieter, native capsule style.
- Every badge must encode meaningful state.
- Green: known/safe/local/healthy.
- Amber: unknown/review.
- Red: destructive/danger.
- Purple only for AI/agent identity if needed.
- Gray for metadata.

### Inspector

- Use grouped rows and separators.
- Avoid metric cards unless comparing values.
- Destructive controls are visually separated.
- Evidence appears before action.
- AI action includes on-demand privacy reassurance.

### Dashboard

- No giant hero/status card unless it contains ranked findings.
- No decorative charts.
- Every dashboard item should navigate to a filtered table.
- System Summary inspector by default.

### Settings

- Grouped settings rows.
- Compact segmented controls.
- Inline validation.
- Explicit storage state.
- AI privacy boundary next to API controls.

## Proposed Execution Plan

### Phase 1: Foundation UI

- Remove heavy card treatment from table screens.
- Convert inspector metric cards to grouped rows.
- Update selected row treatment.
- Tighten table density.
- Add active filter chips.

### Phase 2: Dashboard

- Replace current dashboard with health briefing rows.
- Make summary rows navigate to filtered views.
- Add System Summary inspector state.
- Remove or demote current connectivity block unless redesigned.

### Phase 3: Cleanup Safety

- Add cleanup reasons.
- Replace "Select all" and direct bulk termination with review flow.
- Add confirmation sheet.
- Show affected ports/services before stopping.

### Phase 4: Network And Services

- Show remote destinations.
- Make services port-first.
- Add network-specific inspector details.
- Add connection expansion or grouped detail.

### Phase 5: Settings And Trust

- Redesign Settings as grouped native rows.
- Add AI privacy copy near API controls.
- Clarify API key storage state.
- Add save/dirty state or auto-save.

## Definition Of Done For The Redesign

The redesign is not done until:

- The app no longer reads as a card dashboard.
- Dashboard answers "what should I inspect first?"
- Processes table shows more rows and scans faster.
- Services lead with ports and local URLs.
- Network shows real destinations, not just protocols.
- Cleanup explains every candidate before selection.
- Termination requires review/confirmation.
- Inspector explains evidence and confidence before actions.
- Settings make the AI privacy boundary obvious.
- Light theme feels native and serious without black slabs or SaaS cards.

