import {
  Activity,
  Bot,
  Gauge,
  Globe,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Lock,
  PanelLeft,
  PanelRight,
  Power,
  RefreshCw,
  Search,
  Server,
  Settings as SettingsIcon,
  Sparkles,
  X,
  type LucideIcon
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { AgentSession, AiExplanation, AppSettings, MenuCommand, ProcessInfo, ProcessSnapshot, SettingsUpdate } from '../shared/types';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { StopSheet, stopTargets, type StopRequest } from './components/StopSheet';
import { AgentMonogram, EmptyState, IconButton, ProcessGlyph, Property, PropertyList, Section, Segmented } from './components/ui';
import { formatClock, formatPercent, pluralize } from './lib/format';
import {
  CATEGORY_LABELS,
  DEFAULT_FILTERS,
  DEFAULT_RULES,
  VIEW_IDS,
  applyUserRules,
  buildSearchText,
  compareProcesses,
  countActiveFilters,
  flattenProcessTree,
  matchesFilters,
  processRuleSignature,
  ruleStateFor,
  type ActivityFilter,
  type CategoryFilter,
  type ProcessFilters,
  type ProcessScope,
  type SortKey,
  type SortState,
  type TreeRow,
  type ViewId
} from './lib/model';
import { isBoolean, isUserRules, migrateLegacyStorage, usePreference } from './lib/storage';
import { AgentInspector, AgentsView } from './views/Agents';
import { Overview } from './views/Overview';
import { ProcessInspector } from './views/ProcessInspector';
import { CleanupTable, NetworkTable, ProcessesTable, ServicesTable, buildServiceRows, type ServiceRow } from './views/ProcessViews';
import { SettingsView } from './views/Settings';

migrateLegacyStorage();

const api = window.metalExplorer;

const VIEW_META: Record<ViewId, { title: string; icon: LucideIcon; shortcut?: string }> = {
  overview: { title: 'Overview', icon: LayoutDashboard, shortcut: '⌘1' },
  agents: { title: 'Agents', icon: Bot, shortcut: '⌘2' },
  processes: { title: 'Processes', icon: Activity, shortcut: '⌘3' },
  services: { title: 'Services', icon: Server, shortcut: '⌘4' },
  network: { title: 'Network', icon: Globe, shortcut: '⌘5' },
  cleanup: { title: 'Cleanup', icon: ListChecks, shortcut: '⌘6' },
  settings: { title: 'Settings', icon: SettingsIcon, shortcut: '⌘,' }
};

const ACTIVITY_CHIPS: Array<{ id: ActivityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Needs review' },
  { id: 'listening', label: 'Listening' },
  { id: 'internet', label: 'Internet' },
  { id: 'orphaned', label: 'Orphaned' },
  { id: 'high-cpu', label: 'High CPU' },
  { id: 'high-memory', label: 'High memory' }
];

const isViewId = (value: unknown): value is ViewId => typeof value === 'string' && (VIEW_IDS as string[]).includes(value);
const isSortState = (value: unknown): value is SortState =>
  Boolean(value) && typeof (value as SortState).key === 'string' && ((value as SortState).direction === 'asc' || (value as SortState).direction === 'desc');

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = usePreference<ViewId>('view', 'overview', isViewId);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ProcessFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = usePreference<SortState>('sort', { key: 'cpuPercent', direction: 'desc' }, isSortState);
  const [treeMode, setTreeMode] = usePreference('treeMode', false, isBoolean);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedServiceKey, setSelectedServiceKey] = useState<string | null>(null);
  const [cleanupChecked, setCleanupChecked] = useState<Set<number>>(new Set());
  const [inspectorOpen, setInspectorOpen] = usePreference('inspectorOpen', true, isBoolean);
  const [sidebarOpen, setSidebarOpen] = usePreference('sidebarOpen', true, isBoolean);
  const [rules, setRules] = usePreference('rules', DEFAULT_RULES, isUserRules);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [stopRequest, setStopRequest] = useState<StopRequest | null>(null);
  const [stopping, setStopping] = useState(false);
  const [ai, setAi] = useState<{ pid: number; explanation: AiExplanation | null; loading: boolean } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const theme = useResolvedTheme(settings?.theme ?? 'system');

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => setToast({ id: Date.now(), message, tone }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.tone === 'error' ? 7000 : 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnapshot(await api.listProcesses());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to read process state.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);

  // One sampling chain at a time. Sampling pauses while the window is hidden.
  const refreshMs = settings?.refreshMs ?? 3000;
  useEffect(() => {
    let timer: number | undefined;
    let inFlight = false;
    let disposed = false;

    const tick = async (): Promise<void> => {
      if (disposed || inFlight) return;
      window.clearTimeout(timer);
      if (document.hidden) return;
      inFlight = true;
      await refresh();
      inFlight = false;
      if (!disposed) timer = window.setTimeout(() => void tick(), refreshMs);
    };

    const onVisibility = (): void => {
      if (!document.hidden) void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, refreshMs]);

  const currentUser = snapshot?.currentUser ?? '';
  const processes = useMemo(() => applyUserRules(snapshot?.processes ?? [], rules), [snapshot, rules]);
  const processByPid = useMemo(() => new Map(processes.map((process) => [process.pid, process])), [processes]);
  const searchIndex = useMemo(() => new Map(processes.map((process) => [process.pid, buildSearchText(process)])), [processes]);
  const agents = snapshot?.agents ?? [];
  const agentsById = useMemo(() => new Map(agents.map((session) => [session.id, session])), [agents]);
  const normalizedQuery = deferredQuery.trim().toLowerCase();

  const filtered = useMemo(
    () => processes.filter((process) => matchesFilters(process, filters, currentUser) && (!normalizedQuery || (searchIndex.get(process.pid) ?? '').includes(normalizedQuery))),
    [currentUser, filters, normalizedQuery, processes, searchIndex]
  );

  const processRows = useMemo<TreeRow[]>(() => {
    if (treeMode) return flattenProcessTree(filtered, sort, collapsed);
    return [...filtered].sort((a, b) => compareProcesses(a, b, sort)).map((process) => ({ process, depth: 0, hasChildren: false, descendantCount: 0 }));
  }, [collapsed, filtered, sort, treeMode]);

  const serviceRows = useMemo(() => {
    const rows = buildServiceRows(filtered);
    return rows.sort((a, b) => (sort.key === 'ports' ? (a.port.port - b.port.port) * (sort.direction === 'asc' ? 1 : -1) : compareProcesses(a.process, b.process, sort)));
  }, [filtered, sort]);

  const networkRows = useMemo(() => filtered.filter((process) => process.networkConnections.length).sort((a, b) => compareProcesses(a, b, sort)), [filtered, sort]);

  const cleanupRows = useMemo(
    () =>
      processes
        .filter((process) => process.cleanCandidate && (!normalizedQuery || (searchIndex.get(process.pid) ?? '').includes(normalizedQuery)))
        .sort((a, b) => compareProcesses(a, b, sort)),
    [normalizedQuery, processes, searchIndex, sort]
  );

  // Drop checked cleanup rows that disappeared.
  useEffect(() => {
    setCleanupChecked((current) => {
      const alive = new Set(cleanupRows.map((process) => process.pid));
      const next = new Set([...current].filter((pid) => alive.has(pid)));
      return next.size === current.size ? current : next;
    });
  }, [cleanupRows]);

  // Keep an agent selected when the Agents view has sessions.
  useEffect(() => {
    if (view === 'agents' && agents.length && (!selectedAgentId || !agentsById.has(selectedAgentId))) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, agentsById, selectedAgentId, view]);

  const selectedAgent = selectedAgentId ? agentsById.get(selectedAgentId) ?? null : null;
  const selectedService = selectedServiceKey ? serviceRows.find((row) => row.key === selectedServiceKey) ?? null : null;
  // Only inspect a process that is visible in the current view, never a stale selection from another view.
  const visiblePids = useMemo(() => {
    if (view === 'network') return new Set(networkRows.map((process) => process.pid));
    if (view === 'cleanup') return new Set(cleanupRows.map((process) => process.pid));
    return null;
  }, [cleanupRows, networkRows, view]);
  const inspectedProcess: ProcessInfo | null =
    view === 'services'
      ? selectedService
        ? processByPid.get(selectedService.process.pid) ?? null
        : null
      : selectedPid !== null && (!visiblePids || visiblePids.has(selectedPid))
        ? processByPid.get(selectedPid) ?? null
        : null;

  const navigate = useCallback(
    (next: ViewId, patch?: Partial<ProcessFilters>) => {
      setView(next);
      setQuery('');
      setFilters({ ...DEFAULT_FILTERS, ...patch });
    },
    [setView]
  );

  const selectProcess = useCallback(
    (pid: number, target: ViewId = 'processes') => {
      const process = processByPid.get(pid);
      navigate(target === 'agents' && process?.agentSessionId ? 'agents' : target === 'agents' ? 'processes' : target);
      if (target === 'agents' && process?.agentSessionId) {
        setSelectedAgentId(process.agentSessionId);
        return;
      }
      setSelectedPid(pid);
      if (target === 'services' && process?.ports[0]) setSelectedServiceKey(`${pid}:${process.ports[0].port}`);
    },
    [navigate, processByPid]
  );

  const selectAgent = useCallback(
    (id: string) => {
      navigate('agents');
      setSelectedAgentId(id);
    },
    [navigate]
  );

  const updateSettings = useCallback(
    async (update: SettingsUpdate) => {
      try {
        setSettings(await api.updateSettings(update));
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save settings.', 'error');
      }
    },
    [notify]
  );

  const openStopSheet = useCallback(
    (pids: number[], source: StopRequest['source'], session?: AgentSession) => {
      const targets = pids.map((pid) => processByPid.get(pid)).filter((process): process is ProcessInfo => Boolean(process));
      if (snapshot && targets.length) setStopRequest({ targets, sampledAt: snapshot.generatedAt, session, source });
    },
    [processByPid, snapshot]
  );

  const requestStop = useCallback(
    (process: ProcessInfo | null) => {
      if (process?.safeToTerminate) openStopSheet([process.pid], 'process');
    },
    [openStopSheet]
  );

  const requestStopAgent = useCallback(
    (session: AgentSession | null) => {
      if (session?.safeToTerminate) openStopSheet([session.rootPid], 'agent', session);
    },
    [openStopSheet]
  );

  async function confirmStop(): Promise<void> {
    if (!stopRequest) return;
    setStopping(true);
    try {
      const results = await api.terminateProcesses(stopTargets(stopRequest));
      const stopped = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);
      if (failed.length && !stopped.length) {
        notify(failed[0].message, 'error');
      } else if (failed.length) {
        notify(`Stopped ${stopped.length} of ${results.length}. ${failed[0].message}`, 'error');
      } else {
        notify(stopRequest.session ? `Stopped ${stopRequest.session.label} session.` : stopped.length === 1 ? stopped[0].message : `Stopped ${stopped.length} processes.`);
      }
      if (stopRequest.source === 'cleanup') setCleanupChecked(new Set());
      setStopRequest(null);
      window.setTimeout(() => void refresh(), 700);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Stopping failed.', 'error');
    } finally {
      setStopping(false);
    }
  }

  const explain = useCallback(
    async (process: ProcessInfo) => {
      setAi({ pid: process.pid, explanation: null, loading: true });
      try {
        const explanation = await api.explainProcess(process.pid);
        setAi({ pid: process.pid, explanation, loading: false });
      } catch (error) {
        setAi(null);
        notify(error instanceof Error ? error.message : 'AI explanation failed.', 'error');
      }
    },
    [notify]
  );

  const copy = useCallback(
    (text: string, label: string) => {
      void api.copyText(text).then(() => notify(`${label} copied.`));
    },
    [notify]
  );

  const openUrl = useCallback(
    (url: string) => {
      void api.openExternal(url).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Could not open that address.', 'error'));
    },
    [notify]
  );

  const focusHost = useCallback(
    (session: AgentSession) => {
      void api.focusAgentHost(session.id).then((ok) => !ok && notify(`Could not bring ${session.host?.name ?? 'the terminal'} forward.`, 'error'));
    },
    [notify]
  );

  const updateRule = useCallback(
    (process: ProcessInfo, action: 'keep' | 'flag' | 'clear') => {
      const signature = processRuleSignature(process);
      setRules((current) => ({
        ...current,
        keep: action === 'keep' ? [...current.keep.filter((item) => item !== signature), signature] : current.keep.filter((item) => item !== signature),
        flag: action === 'flag' ? [...current.flag.filter((item) => item !== signature), signature] : current.flag.filter((item) => item !== signature)
      }));
    },
    [setRules]
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      setSort((current) =>
        current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'name' || key === 'user' || key === 'category' || key === 'ports' ? 'asc' : 'desc' }
      );
    },
    [setSort]
  );

  const stopSelected = useCallback(() => {
    if (view === 'agents') requestStopAgent(selectedAgent);
    else if (view === 'cleanup' && cleanupChecked.size) openStopSheet([...cleanupChecked], 'cleanup');
    else requestStop(inspectedProcess);
  }, [cleanupChecked, inspectedProcess, openStopSheet, requestStop, requestStopAgent, selectedAgent, view]);

  const handleCommand = useCallback(
    (command: MenuCommand) => {
      switch (command.type) {
        case 'navigate':
          if (isViewId(command.view)) navigate(command.view);
          break;
        case 'find':
          if (view === 'settings' || view === 'overview') navigate('processes');
          window.setTimeout(() => searchRef.current?.focus(), 0);
          break;
        case 'refresh':
          void refresh();
          break;
        case 'command-palette':
          setPaletteOpen((open) => !open);
          break;
        case 'toggle-inspector':
          setInspectorOpen((open) => !open);
          break;
        case 'toggle-sidebar':
          setSidebarOpen((open) => !open);
          break;
        case 'stop-selected':
          stopSelected();
          break;
        case 'focus-agent':
          selectAgent(command.sessionId);
          break;
      }
    },
    [navigate, refresh, selectAgent, setInspectorOpen, setSidebarOpen, stopSelected, view]
  );

  useEffect(() => api.onMenuCommand(handleCommand), [handleCommand]);

  // Keyboard shortcuts that also work without the native menu.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === 'Escape' && typing && target === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      } else if (event.key === '/' && !typing && !paletteOpen && !stopRequest) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, stopRequest]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    // Built only while the palette is open; hundreds of rows otherwise rebuild on every sample.
    if (!paletteOpen) return [];
    const items: PaletteItem[] = VIEW_IDS.map((id) => ({
      id: `view-${id}`,
      group: 'Go to',
      label: VIEW_META[id].title,
      icon: VIEW_META[id].icon,
      shortcut: VIEW_META[id].shortcut,
      run: () => navigate(id)
    }));
    items.push(
      { id: 'refresh', group: 'Actions', label: 'Refresh now', icon: RefreshCw, shortcut: '⌘R', run: () => void refresh() },
      { id: 'tree', group: 'Actions', label: treeMode ? 'Show flat process list' : 'Show process tree', icon: ListTree, run: () => (setTreeMode(!treeMode), navigate('processes')) },
      { id: 'inspector', group: 'Actions', label: inspectorOpen ? 'Hide inspector' : 'Show inspector', icon: PanelRight, shortcut: '⌥⌘I', run: () => setInspectorOpen(!inspectorOpen) },
      { id: 'orphans', group: 'Actions', label: 'Show orphaned processes', icon: ListChecks, run: () => navigate('processes', { activity: 'orphaned' }) },
      { id: 'exposed', group: 'Actions', label: 'Show services reachable from the network', icon: Server, run: () => navigate('services') }
    );
    if (settings && !settings.agentUsage) {
      items.push({ id: 'insights', group: 'Actions', label: 'Turn on agent session insights', icon: Sparkles, run: () => void updateSettings({ agentUsage: true }) });
    }
    if (inspectedProcess?.safeToTerminate && view !== 'agents') {
      items.push({ id: 'stop', group: 'Actions', label: `Stop ${inspectedProcess.name}…`, icon: Power, shortcut: '⌘⌫', run: () => requestStop(inspectedProcess) });
    }
    for (const session of agents) {
      items.push({
        id: `agent-${session.id}`,
        group: 'Agents',
        label: session.title ?? session.projectName,
        detail: `${session.label} · ${formatPercent(session.cpuPercent)}`,
        keywords: `${session.cwd ?? ''} ${session.host?.name ?? ''}`,
        leading: <AgentMonogram kind={session.kind} size={18} />,
        run: () => selectAgent(session.id)
      });
    }
    for (const process of processes) {
      items.push({
        id: `pid-${process.pid}`,
        group: 'Processes',
        label: process.name,
        detail: `PID ${process.pid} · ${CATEGORY_LABELS[process.category]}`,
        keywords: `${process.pid} ${process.provenance.appBundle ?? ''} ${process.ports.map((port) => port.port).join(' ')}`,
        leading: <ProcessGlyph process={process} />,
        run: () => selectProcess(process.pid)
      });
    }
    return items;
  }, [agents, inspectedProcess, inspectorOpen, navigate, paletteOpen, processes, refresh, requestStop, selectAgent, selectProcess, setInspectorOpen, setTreeMode, settings, treeMode, updateSettings, view]);

  const counts: Partial<Record<ViewId, number>> = snapshot
    ? {
        agents: agents.length,
        processes: snapshot.summary.totalProcesses,
        services: snapshot.summary.listeningPorts,
        network: snapshot.summary.internetProcesses,
        cleanup: processes.filter((process) => process.cleanCandidate).length
      }
    : {};
  const working = agents.filter((session) => session.status === 'working').length;
  const showInspector = inspectorOpen && view !== 'settings';
  const showFilterBar = view === 'processes' || view === 'services' || view === 'network';
  const activeFilters = countActiveFilters(filters) + Number(filters.scope !== 'all');

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'} ${showInspector ? '' : 'inspector-hidden'} ${api.vibrancy ? 'has-vibrancy' : ''}`} data-theme={theme}>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="titlebar-spacer" />
        <nav className="source-list">
          <SidebarGroup title="Monitor">
            {(['overview', 'agents', 'processes', 'services', 'network'] as ViewId[]).map((id) => (
              <SidebarItem
                key={id}
                id={id}
                active={view === id}
                count={counts[id]}
                indicator={id === 'agents' && working ? 'working' : undefined}
                onClick={() => navigate(id)}
              />
            ))}
          </SidebarGroup>
          <SidebarGroup title="Maintain">
            <SidebarItem id="cleanup" active={view === 'cleanup'} count={counts.cleanup} indicator={counts.cleanup ? 'attention' : undefined} onClick={() => navigate('cleanup')} />
          </SidebarGroup>
        </nav>
        <div className="sidebar-footer">
          <SidebarItem id="settings" active={view === 'settings'} onClick={() => navigate('settings')} />
          <div className="live-status" title={snapshot ? `Last sample ${formatClock(snapshot.generatedAt)}` : 'Starting'}>
            <span className={`live-dot ${loadError ? 'is-error' : snapshot ? '' : 'is-waiting'}`} />
            <span>{loadError ? 'Sampling failed' : snapshot ? `Live · every ${Math.round(refreshMs / 1000)}s` : 'Starting…'}</span>
            <Lock size={11} className="live-lock" aria-label="Local only" />
          </div>
        </div>
      </aside>

      <header className="toolbar">
        <IconButton icon={PanelLeft} label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setSidebarOpen(!sidebarOpen)} className="toolbar-sidebar-toggle" />
        <div className="toolbar-title">
          <h1>{VIEW_META[view].title}</h1>
          <span>{toolbarSubtitle(view, snapshot, { filtered: filtered.length, services: serviceRows.length, network: networkRows.length, cleanup: cleanupRows.length })}</span>
        </div>
        <div className="toolbar-flex" />
        {view === 'processes' ? (
          <Segmented<'flat' | 'tree'>
            label="Process layout"
            size="small"
            value={treeMode ? 'tree' : 'flat'}
            onChange={(value) => setTreeMode(value === 'tree')}
            options={[
              { id: 'flat', label: 'List' },
              { id: 'tree', label: 'Tree', icon: ListTree }
            ]}
          />
        ) : null}
        {view !== 'settings' && view !== 'overview' ? (
          <label className="search-field">
            <Search size={14} strokeWidth={2} aria-hidden />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} aria-label="Search" />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={12} strokeWidth={2.4} />
              </button>
            ) : null}
          </label>
        ) : null}
        <IconButton icon={RefreshCw} label="Refresh now" onClick={() => void refresh()} spinning={refreshing && !snapshot} />
        <IconButton icon={PanelRight} label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} active={showInspector} onClick={() => setInspectorOpen(!inspectorOpen)} disabled={view === 'settings'} />
      </header>
      <main className="content">

        {showFilterBar ? (
          <div className="filter-bar">
            {view === 'processes' ? (
              <Segmented<ProcessScope>
                label="Process owner"
                size="small"
                value={filters.scope}
                onChange={(scope) => setFilters((current) => ({ ...current, scope }))}
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'mine', label: 'Mine' },
                  { id: 'system', label: 'System' }
                ]}
              />
            ) : null}
            <div className="chip-group" role="group" aria-label="Activity filter">
              {ACTIVITY_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`chip ${filters.activity === chip.id ? 'is-active' : ''}`}
                  aria-pressed={filters.activity === chip.id}
                  onClick={() => setFilters((current) => ({ ...current, activity: chip.id }))}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <select className="select" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value as CategoryFilter }))} aria-label="Kind">
              <option value="all">All kinds</option>
              {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
            {activeFilters ? (
              <button type="button" className="link" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Clear
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="content-body">
          {!snapshot ? (
            loadError ? (
              <EmptyState icon={Gauge} title="MetalExplorer could not read process state" detail={loadError} />
            ) : (
              <div className="loading-state">
                <span className="spinner" />
                <span>Reading processes…</span>
              </div>
            )
          ) : view === 'overview' ? (
            <Overview snapshot={snapshot} processes={processes} onNavigate={navigate} onSelectProcess={selectProcess} onSelectAgent={selectAgent} />
          ) : view === 'agents' ? (
            <AgentsView
              agents={agents}
              query={deferredQuery}
              selectedId={selectedAgentId}
              settings={settings}
              onSelect={setSelectedAgentId}
              onEnableInsights={() => void updateSettings({ agentUsage: true })}
              onFocusHost={focusHost}
            />
          ) : view === 'processes' ? (
            <ProcessesTable
              rows={processRows}
              treeMode={treeMode}
              collapsed={collapsed}
              selectedPid={selectedPid}
              sort={sort}
              onSort={handleSort}
              onSelect={setSelectedPid}
              onToggle={(pid) =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(pid)) next.delete(pid);
                  else next.add(pid);
                  return next;
                })
              }
            />
          ) : view === 'services' ? (
            <ServicesTable rows={serviceRows} selectedKey={selectedServiceKey} agentsById={agentsById} sort={sort} onSort={handleSort} onSelect={(row: ServiceRow) => setSelectedServiceKey(row.key)} onOpen={openUrl} />
          ) : view === 'network' ? (
            <NetworkTable rows={networkRows} selectedPid={selectedPid} sort={sort} onSort={handleSort} onSelect={setSelectedPid} />
          ) : view === 'cleanup' ? (
            <CleanupTable
              rows={cleanupRows}
              checked={cleanupChecked}
              selectedPid={selectedPid}
              sort={sort}
              onSort={handleSort}
              onSelect={setSelectedPid}
              onToggle={(pid) =>
                setCleanupChecked((current) => {
                  const next = new Set(current);
                  if (next.has(pid)) next.delete(pid);
                  else next.add(pid);
                  return next;
                })
              }
              onToggleAll={() => setCleanupChecked((current) => (current.size === cleanupRows.length ? new Set() : new Set(cleanupRows.map((process) => process.pid))))}
              onReview={() => openStopSheet([...cleanupChecked], 'cleanup')}
            />
          ) : settings ? (
            <SettingsView settings={settings} rules={rules} onUpdate={updateSettings} onRulesChange={setRules} onResetRules={() => setRules(DEFAULT_RULES)} />
          ) : null}
        </div>
      </main>

      {showInspector ? (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-scroll">
            {view === 'agents' && selectedAgent ? (
              <AgentInspector
                session={selectedAgent}
                settings={settings}
                onFocusHost={focusHost}
                onReveal={(session) => void api.revealAgentFolder(session.id).then((ok) => !ok && notify('That folder is no longer available.', 'error'))}
                onCopy={copy}
                onStop={requestStopAgent}
                onSelectProcess={(pid) => selectProcess(pid)}
                onOpenUrl={openUrl}
                onEnableInsights={() => void updateSettings({ agentUsage: true })}
              />
            ) : view !== 'overview' && view !== 'agents' && inspectedProcess ? (
              <ProcessInspector
                process={inspectedProcess}
                sampleKey={snapshot?.generatedAt ?? ''}
                session={inspectedProcess.agentSessionId ? agentsById.get(inspectedProcess.agentSessionId) ?? null : null}
                ruleState={ruleStateFor(inspectedProcess, rules)}
                aiExplanation={ai?.pid === inspectedProcess.pid ? ai.explanation : null}
                aiLoading={ai?.pid === inspectedProcess.pid && ai.loading}
                hasApiKey={Boolean(settings?.hasApiKey)}
                onExplain={() => void explain(inspectedProcess)}
                onStop={() => requestStop(inspectedProcess)}
                onOpenUrl={openUrl}
                onRule={(action) => updateRule(inspectedProcess, action)}
                onExport={() => void api.exportDiagnostics(inspectedProcess.pid).then((result) => result.ok && notify(result.message))}
                onCopy={copy}
                onSelectProcess={(pid) => selectProcess(pid)}
                onSelectAgent={selectAgent}
              />
            ) : (
              <MacInspector snapshot={snapshot} view={view} />
            )}
          </div>
        </aside>
      ) : null}

      {stopRequest ? <StopSheet request={stopRequest} busy={stopping} onCancel={() => setStopRequest(null)} onConfirm={() => void confirmStop()} /> : null}
      {paletteOpen ? <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} /> : null}
      {toast ? (
        <div key={toast.id} className={`toast tone-${toast.tone}`} role="status">
          {toast.message}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarGroup({ title, children }: { title: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <div className="sidebar-group">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function SidebarItem({ id, active, count, indicator, onClick }: { id: ViewId; active: boolean; count?: number; indicator?: 'working' | 'attention'; onClick: () => void }): JSX.Element {
  const Icon = VIEW_META[id].icon;
  return (
    <button type="button" className={`sidebar-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon size={16} strokeWidth={1.8} aria-hidden />
      <span className="sidebar-label">{VIEW_META[id].title}</span>
      {indicator ? <span className={`sidebar-indicator is-${indicator}`} /> : null}
      {count !== undefined ? <span className="sidebar-count">{count}</span> : null}
    </button>
  );
}

function MacInspector({ snapshot, view }: { snapshot: ProcessSnapshot | null; view: ViewId }): JSX.Element {
  if (!snapshot) {
    return <EmptyState icon={Gauge} title="Measuring" />;
  }
  const { summary, system } = snapshot;
  return (
    <div className="inspector-content">
      <header className="inspector-hero">
        <span className="hero-glyph mac-glyph">
          <Gauge size={18} />
        </span>
        <div>
          <h2>This Mac</h2>
          <p>Sampled {formatClock(snapshot.generatedAt)}</p>
        </div>
      </header>
      {view !== 'overview' ? <p className="inspector-lede muted">Select a row to inspect it.</p> : null}
      <Section title="Processes">
        <PropertyList>
          <Property label="Running">{summary.totalProcesses}</Property>
          <Property label="Yours">{summary.userProcesses}</Property>
          <Property label="macOS">{summary.macosSystem}</Property>
          <Property label="Listening ports">{summary.listeningPorts}</Property>
          <Property label="On the internet">{pluralize(summary.internetProcesses, 'process', 'processes')}</Property>
          <Property label="Coding agents">{snapshot.agents.length}</Property>
        </PropertyList>
      </Section>
      <Section title="System">
        <PropertyList>
          <Property label="CPU in use" mono>
            {formatPercent(system.cpuUsagePercent)}
          </Property>
          <Property label="Load average" mono>
            {system.loadAverage.map((value) => value.toFixed(2)).join(' ')}
          </Property>
          <Property label="Memory pressure">{system.memoryPressure}</Property>
        </PropertyList>
      </Section>
      <Section title="Privacy">
        <p className="muted-note">Everything here was read locally. Nothing is uploaded, and process history is kept in memory only until you quit.</p>
      </Section>
    </div>
  );
}

function toolbarSubtitle(view: ViewId, snapshot: ProcessSnapshot | null, counts: { filtered: number; services: number; network: number; cleanup: number }): string {
  if (!snapshot) return '';
  switch (view) {
    case 'overview':
      return `Updated ${formatClock(snapshot.generatedAt)}`;
    case 'agents':
      return pluralize(snapshot.agents.length, 'session');
    case 'processes':
      return counts.filtered === snapshot.summary.totalProcesses ? pluralize(counts.filtered, 'process', 'processes') : `${counts.filtered} of ${snapshot.summary.totalProcesses}`;
    case 'services':
      return pluralize(counts.services, 'listening port');
    case 'network':
      return pluralize(counts.network, 'process', 'processes');
    case 'cleanup':
      return pluralize(counts.cleanup, 'candidate');
    default:
      return 'Preferences';
  }
}

function useResolvedTheme(theme: AppSettings['theme']): 'light' | 'dark' | 'matrix' {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
