import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  Command,
  ExternalLink,
  FileDown,
  Info,
  ListChecks,
  Lock,
  Monitor,
  Network,
  Power,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  X
} from 'lucide-react';
import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { AiExplanation, AppSettings, ProcessCategory, ProcessInfo, ProcessSnapshot, ThemeName } from '../shared/types';

type ViewId = 'dashboard' | 'processes' | 'services' | 'agents' | 'cleanup' | 'network' | 'settings';
type CategoryFilter = 'all' | 'local-server' | 'ai-agent' | 'developer-tool' | 'database' | 'unknown';
type RiskFilter = 'all' | 'review' | 'high';
type ActivityFilter = 'all' | 'internet' | 'listening' | 'cleanup' | 'high-traffic' | 'non-local';
type ProcessFilters = {
  category: CategoryFilter;
  risk: RiskFilter;
  activity: ActivityFilter;
};
type UserRulePreset = 'balanced' | 'focus' | 'deep-dev' | 'strict';
type UserRules = {
  preset: UserRulePreset;
  keep: string[];
  flag: string[];
};
type TrendSample = {
  t: number;
  cpu: number;
  mem: number;
  down: number;
  up: number;
};
type TrendEntry = {
  key: string;
  name: string;
  category: ProcessCategory;
  samples: TrendSample[];
};
type ProcessTrendSummary = {
  samples: number;
  avgCpu: number;
  peakCpu: number;
  avgMemoryMb: number;
  peakTrafficBps: number;
  firstSeen: number;
  lastSeen: number;
};
type SortKey =
  | 'cpuPercent'
  | 'rssKb'
  | 'name'
  | 'category'
  | 'uptimeSeconds'
  | 'ports'
  | 'connections'
  | 'networkDownloadBps'
  | 'networkUploadBps';

const CATEGORY_LABELS: Record<ProcessCategory, string> = {
  'macos-system': 'macOS',
  'local-server': 'Server',
  'ai-agent': 'Agent',
  'developer-tool': 'Dev tool',
  database: 'Database',
  browser: 'Browser',
  'user-app': 'App',
  unknown: 'Unknown process'
};

const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Light',
  dark: 'Graphite Dark',
  matrix: 'Matrix'
};

const DEFAULT_FILTERS: ProcessFilters = {
  category: 'all',
  risk: 'all',
  activity: 'all'
};
const DEFAULT_RULES: UserRules = {
  preset: 'balanced',
  keep: [],
  flag: []
};
const TREND_STORAGE_KEY = 'metalexplorer.trends.v1';
const RULE_STORAGE_KEY = 'metalexplorer.rules.v1';
const TREND_RETENTION_MS = 24 * 60 * 60 * 1000;
const TREND_SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const HIGH_TRAFFIC_BPS = 100 * 1024;
const RULE_PRESETS: Array<{ id: UserRulePreset; label: string }> = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'focus', label: 'Focus' },
  { id: 'deep-dev', label: 'Deep dev' },
  { id: 'strict', label: 'Strict' }
];

const VIEW_TITLES: Record<ViewId, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Local workload, status, and network activity' },
  processes: { title: 'Processes', subtitle: 'All running macOS processes' },
  services: { title: 'Services', subtitle: 'Processes listening on local TCP ports' },
  agents: { title: 'Agents', subtitle: 'AI, MCP, and automation-related processes' },
  cleanup: { title: 'Cleanup', subtitle: 'User-owned processes likely safe to stop' },
  network: { title: 'Network', subtitle: 'Processes communicating with the internet' },
  settings: { title: 'Settings', subtitle: 'AI endpoint, theme, and refresh preferences' }
};

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<ViewId>('dashboard');
  const [query, setQuery] = useState('');
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('cpuPercent');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [aiExplanation, setAiExplanation] = useState<AiExplanation | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmPid, setConfirmPid] = useState<number | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleanupSelection, setCleanupSelection] = useState<Set<number>>(new Set());
  const [connectivityHistory, setConnectivityHistory] = useState<number[]>(Array.from({ length: 72 }, () => 0));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredBoolean('metalexplorer.sidebarCollapsed', false));
  const [filtersVisible, setFiltersVisible] = useState(() => readStoredBoolean('metalexplorer.filtersVisible', false));
  const [filters, setFilters] = useState<ProcessFilters>(DEFAULT_FILTERS);
  const [userRules, setUserRules] = useState<UserRules>(() => readUserRules());
  const [trendSummaries, setTrendSummaries] = useState<Map<string, ProcessTrendSummary>>(() => summarizeTrendEntries(readTrendEntries()));
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => clamp(readStoredNumber('metalexplorer.sidebarWidth', 232), 190, 320));
  const [inspectorWidth, setInspectorWidth] = useState(() => clamp(readStoredNumber('metalexplorer.inspectorWidth', 356), 300, 620));
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const deferredQuery = useDeferredValue(query);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const run = (async () => {
      try {
        const nextSnapshot = await window.metalExplorer.listProcesses();
        const availablePids = new Set(nextSnapshot.processes.map((process) => process.pid));
        setSnapshot(nextSnapshot);
        setSelectedPid((currentPid) => {
          if (currentPid && availablePids.has(currentPid)) {
            return currentPid;
          }

          return pickFocusProcess(nextSnapshot.processes)?.pid ?? nextSnapshot.processes[0]?.pid ?? null;
        });
        setNotice('');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Unable to read process state.');
      } finally {
        setLoading(false);
        refreshInFlight.current = null;
      }
    })();

    refreshInFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
    void window.metalExplorer.getSettings().then(setSettings);
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), settings?.refreshMs ?? 3000);
    return () => window.clearInterval(interval);
  }, [refresh, settings?.refreshMs]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const activity =
      snapshot.summary.externalConnections > 0 || (snapshot.summary.networkDownloadBps ?? 0) + (snapshot.summary.networkUploadBps ?? 0) > 0 ? 1 : 0;
    setConnectivityHistory((previous) => [...previous.slice(-71), activity]);
  }, [snapshot?.generatedAt]);

  useEffect(() => {
    writeStoredBoolean('metalexplorer.sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    writeStoredNumber('metalexplorer.sidebarWidth', sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    writeStoredNumber('metalexplorer.inspectorWidth', inspectorWidth);
  }, [inspectorWidth]);

  useEffect(() => {
    writeStoredBoolean('metalexplorer.filtersVisible', filtersVisible);
  }, [filtersVisible]);

  useEffect(() => {
    writeStoredJson(RULE_STORAGE_KEY, userRules);
  }, [userRules]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    setTrendSummaries(updateStoredTrendEntries(snapshot.processes, new Date(snapshot.generatedAt).getTime()));
  }, [snapshot?.generatedAt]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandOpen((open) => !open);
        setCommandQuery('');
      }

      if (event.key === 'Escape') {
        setCommandOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const rawProcesses = snapshot?.processes ?? [];
  const processes = useMemo(() => applyUserRules(rawProcesses, userRules), [rawProcesses, userRules]);
  const buckets = useMemo(() => buildProcessBuckets(processes), [processes]);
  const { cleanCandidates, localServices, agents, networkProcesses, highLoad, processByPid, searchIndex } = buckets;
  const selectedProcess = (selectedPid ? processByPid.get(selectedPid) : null) ?? pickFocusProcess(processes);
  const terminationReviewProcess = confirmPid ? processByPid.get(confirmPid) ?? null : null;
  const tableView = view !== 'dashboard' && view !== 'settings';
  const activeFilterCount = countActiveFilters(filters);
  const sampleStatus = getSampleStatus(snapshot, settings?.refreshMs ?? 3000);

  const filteredProcesses = useMemo(() => {
    const base = getBaseProcessesForView(view, processes);
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const filtered = base.filter((process) => {
      if (!matchesProcessFilters(process, filters)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (searchIndex.get(process.pid) ?? '').includes(normalizedQuery);
    });

    return filtered.sort((a, b) => compareProcesses(a, b, sortKey, sortDirection));
  }, [deferredQuery, filters, processes, searchIndex, sortDirection, sortKey, view]);

  useEffect(() => {
    if (!tableView || !filteredProcesses.length) {
      return;
    }

    if (!selectedPid || !filteredProcesses.some((process) => process.pid === selectedPid)) {
      setSelectedPid(filteredProcesses[0].pid);
      setAiExplanation(null);
    }
  }, [filteredProcesses, selectedPid, tableView]);

  function changeView(nextView: ViewId, nextFilters?: Partial<ProcessFilters>): void {
    setView(nextView);
    setQuery('');
    setAiExplanation(null);
    setConfirmCleanup(false);

    if (nextFilters) {
      setFilters({ ...DEFAULT_FILTERS, ...nextFilters });
      setFiltersVisible(countActiveFilters({ ...DEFAULT_FILTERS, ...nextFilters }) > 0);
    }

    if (nextView === 'processes') {
      setSelectedPid(processes[0]?.pid ?? selectedPid);
    }
    if (nextView === 'services') {
      setSelectedPid(localServices[0]?.pid ?? selectedPid);
    }
    if (nextView === 'agents') {
      setSelectedPid(agents[0]?.pid ?? selectedPid);
    }
    if (nextView === 'cleanup') {
      setSelectedPid(cleanCandidates[0]?.pid ?? selectedPid);
    }
    if (nextView === 'network') {
      setSelectedPid(networkProcesses[0]?.pid ?? selectedPid);
    }
  }

  function handleSort(nextKey: SortKey): void {
    if (sortKey === nextKey) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === 'name' || nextKey === 'category' ? 'asc' : 'desc');
  }

  function beginResize(kind: 'sidebar' | 'inspector', event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebar = sidebarWidth;
    const startInspector = inspectorWidth;
    document.body.classList.add('is-resizing');

    const handleMove = (moveEvent: MouseEvent): void => {
      if (kind === 'sidebar') {
        setSidebarCollapsed(false);
        setSidebarWidth(clamp(startSidebar + moveEvent.clientX - startX, 190, 320));
        return;
      }

      setInspectorWidth(clamp(startInspector - (moveEvent.clientX - startX), 300, 620));
    };

    const handleUp = (): void => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }

  async function explainSelected(): Promise<void> {
    if (!selectedProcess) {
      return;
    }

    setAiLoading(true);
    setAiExplanation(null);
    try {
      setAiExplanation(await window.metalExplorer.explainProcess(selectedProcess));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI explanation failed.');
    } finally {
      setAiLoading(false);
    }
  }

  function reviewSelectedTermination(): void {
    if (!selectedProcess?.safeToTerminate) {
      return;
    }

    setConfirmPid(selectedProcess.pid);
  }

  async function confirmTermination(pid: number): Promise<void> {
    const result = await window.metalExplorer.terminateProcess(pid);
    setNotice(result.message);
    setConfirmPid(null);
    await refresh();
  }

  async function terminateCleanupSelection(): Promise<void> {
    const pids = [...cleanupSelection];
    if (!pids.length) {
      setCleanupSelection(new Set(cleanCandidates.map((process) => process.pid)));
      setNotice('Selected recommended cleanup candidates. Review the list before stopping anything.');
      return;
    }

    if (!confirmCleanup) {
      setConfirmCleanup(true);
      return;
    }

    const results = await Promise.all(pids.map((pid) => window.metalExplorer.terminateProcess(pid)));
    const stopped = results.filter((result) => result.ok).length;
    setNotice(`Stopped ${stopped} of ${pids.length} selected cleanup candidates.`);
    setCleanupSelection(new Set());
    setConfirmCleanup(false);
    await refresh();
  }

  async function openSelectedService(process: ProcessInfo): Promise<void> {
    const firstPort = process.ports[0];
    if (!firstPort) {
      return;
    }

    const host = firstPort.address === '*' || firstPort.address === '0.0.0.0' ? 'localhost' : firstPort.address;
    const normalizedHost = host === '::1' ? '[::1]' : host;
    await window.metalExplorer.openExternal(`http://${normalizedHost}:${firstPort.port}`);
  }

  function updateRule(process: ProcessInfo, action: 'keep' | 'flag' | 'clear'): void {
    const signature = processRuleSignature(process);
    setUserRules((current) => {
      const keep = current.keep.filter((value) => value !== signature);
      const flag = current.flag.filter((value) => value !== signature);

      if (action === 'keep') {
        keep.push(signature);
      }

      if (action === 'flag') {
        flag.push(signature);
      }

      return { ...current, keep, flag };
    });
  }

  async function exportSelectedDiagnostics(): Promise<void> {
    if (!selectedProcess) {
      return;
    }

    const result = await window.metalExplorer.exportDiagnostics(selectedProcess);
    setNotice(result.message);
  }

  function clearLocalLearning(): void {
    window.localStorage.removeItem(TREND_STORAGE_KEY);
    window.localStorage.removeItem(RULE_STORAGE_KEY);
    setUserRules(DEFAULT_RULES);
    setTrendSummaries(new Map());
    setNotice('Local trends and user rules cleared.');
  }

  const navigation = buildNavigation(snapshot);
  const title = VIEW_TITLES[view];
  const theme = settings?.theme ?? 'light';
  const gridTemplateColumns = `${sidebarCollapsed ? 64 : sidebarWidth}px 6px minmax(0, 1fr) 6px ${inspectorWidth}px`;

  return (
    <div className="app-frame" data-theme={theme} style={{ gridTemplateColumns }}>
      <aside className={sidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="window-spacer" />
        <div className="brand">
          <div className="brand-symbol">M</div>
          <div className="brand-copy">
            <strong>MetalExplorer</strong>
            <span>Local Mac</span>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Sections">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => changeView(item.id)}
                title={item.label}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <Lock size={14} />
          <span>Local first</span>
        </div>
      </aside>

      <div className="resize-handle sidebar-resizer" onMouseDown={(event) => beginResize('sidebar', event)} />

      <main className="content">
        <header className="toolbar">
          <div className="toolbar-title">
            <h1>{title.title}</h1>
            <p>{title.subtitle}</p>
          </div>
          <div className="toolbar-actions">
            <span className={`sample-status ${sampleStatus.tone}`}>{sampleStatus.label}</span>
            {view !== 'settings' ? (
              <label className="search-field">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
              </label>
            ) : null}
            {tableView ? (
              <button
                className={filtersVisible ? 'filter-toggle active' : 'filter-toggle'}
                type="button"
                onClick={() => setFiltersVisible((visible) => !visible)}
                aria-pressed={filtersVisible}
              >
                <SlidersHorizontal size={15} />
                <span>Filters</span>
                {activeFilterCount ? <strong>{activeFilterCount}</strong> : null}
              </button>
            ) : null}
            <button className="toolbar-button" type="button" onClick={() => void refresh()} aria-label="Refresh">
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </header>

        {notice ? (
          <div className="banner">
            <Info size={16} />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ) : null}

        {tableView && filtersVisible ? (
          <FilterBar
            filters={filters}
            activeCount={activeFilterCount}
            onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
            onClear={() => setFilters(DEFAULT_FILTERS)}
          />
        ) : null}

        {view === 'dashboard' ? (
          <Dashboard
            snapshot={snapshot}
            processes={processes}
            highLoad={highLoad}
            localServices={localServices}
            cleanCandidates={cleanCandidates}
            networkProcesses={networkProcesses}
            connectivityHistory={connectivityHistory}
            onSelect={(pid, targetView = 'processes') => {
              setSelectedPid(pid);
              setView(targetView);
            }}
            onNavigate={changeView}
          />
        ) : null}

        {view === 'settings' ? <SettingsPanel settings={settings} userRules={userRules} onRulesChange={setUserRules} onClearLocalLearning={clearLocalLearning} onSaved={setSettings} /> : null}

        {view !== 'dashboard' && view !== 'settings' ? (
          <ProcessTable
            view={view}
            processes={filteredProcesses}
            selectedPid={selectedProcess?.pid ?? null}
            sortKey={sortKey}
            sortDirection={sortDirection}
            cleanupSelection={cleanupSelection}
            onSort={handleSort}
            onSelect={(pid) => {
              setSelectedPid(pid);
              setAiExplanation(null);
            }}
            onToggleCleanup={(pid) => {
              setCleanupSelection((previous) => {
                const next = new Set(previous);
                if (next.has(pid)) {
                  next.delete(pid);
                } else {
                  next.add(pid);
                }
                setConfirmCleanup(false);
                return next;
              });
            }}
            onTerminateSelection={() => void terminateCleanupSelection()}
            onReviewSelectedNetwork={reviewSelectedTermination}
            onOpenService={(process) => void openSelectedService(process)}
          />
        ) : null}
      </main>

      <div className="resize-handle inspector-resizer" onMouseDown={(event) => beginResize('inspector', event)} />

      <aside className="inspector">
        {view === 'settings' ? (
          <PrivacyPanel settings={settings} />
        ) : view === 'dashboard' ? (
          <SystemInspector
            snapshot={snapshot}
            processes={processes}
            highLoad={highLoad}
            localServices={localServices}
            cleanCandidates={cleanCandidates}
            networkProcesses={networkProcesses}
            onNavigate={changeView}
          />
        ) : (
          <Inspector
            process={selectedProcess}
            aiExplanation={aiExplanation}
            aiLoading={aiLoading}
            trend={selectedProcess ? trendSummaries.get(processTrendKey(selectedProcess)) ?? null : null}
            ruleState={selectedProcess ? ruleStateForProcess(selectedProcess, userRules) : 'none'}
            onExplain={() => void explainSelected()}
            onTerminate={reviewSelectedTermination}
            onOpenService={(process) => void openSelectedService(process)}
            onRuleChange={updateRule}
            onExportDiagnostics={() => void exportSelectedDiagnostics()}
          />
        )}
      </aside>

      {terminationReviewProcess ? (
        <TerminationReview
          process={terminationReviewProcess}
          onCancel={() => setConfirmPid(null)}
          onConfirm={(pid) => void confirmTermination(pid)}
        />
      ) : null}

      {confirmCleanup ? (
        <CleanupReview
          processes={cleanCandidates.filter((process) => cleanupSelection.has(process.pid))}
          onCancel={() => setConfirmCleanup(false)}
          onConfirm={() => void terminateCleanupSelection()}
        />
      ) : null}

      {commandOpen ? (
        <CommandPalette
          query={commandQuery}
          process={selectedProcess}
          onQueryChange={setCommandQuery}
          onClose={() => setCommandOpen(false)}
          onNavigate={(targetView, nextFilters) => {
            changeView(targetView, nextFilters);
            setCommandOpen(false);
          }}
          onExplain={() => {
            setCommandOpen(false);
            void explainSelected();
          }}
          onTerminate={() => {
            setCommandOpen(false);
            reviewSelectedTermination();
          }}
          onOpenService={(process) => {
            setCommandOpen(false);
            void openSelectedService(process);
          }}
        />
      ) : null}
    </div>
  );
}

function Dashboard({
  snapshot,
  processes,
  highLoad,
  localServices,
  cleanCandidates,
  networkProcesses,
  connectivityHistory,
  onSelect,
  onNavigate
}: {
  snapshot: ProcessSnapshot | null;
  processes: ProcessInfo[];
  highLoad: ProcessInfo[];
  localServices: ProcessInfo[];
  cleanCandidates: ProcessInfo[];
  networkProcesses: ProcessInfo[];
  connectivityHistory: number[];
  onSelect: (pid: number, targetView?: ViewId) => void;
  onNavigate: (view: ViewId, filters?: Partial<ProcessFilters>) => void;
}): JSX.Element {
  const status = getSystemStatus(snapshot, processes);
  const topReview = buildReviewQueue(processes, highLoad, localServices, cleanCandidates, networkProcesses).slice(0, 4);

  return (
    <div className="dashboard scroll-area">
      <section className={`health-briefing ${status.tone}`}>
        <div className="health-status">
          <span className="section-kicker">System Health</span>
          <h2>{status.label}</h2>
          <p>{status.description}</p>
        </div>

        <div className="health-findings">
          <FindingRow
            tone={(snapshot?.summary.unknownNetworkListeners ?? 0) ? 'warning' : 'good'}
            label={(snapshot?.summary.unknownNetworkListeners ?? 0) ? 'Unknown listener needs review' : 'No unknown listeners'}
            detail={(snapshot?.summary.unknownNetworkListeners ?? 0) ? `${snapshot?.summary.unknownNetworkListeners ?? 0} local listener${(snapshot?.summary.unknownNetworkListeners ?? 0) === 1 ? '' : 's'}` : 'Local ports look classified'}
            onClick={() => onNavigate('services', { category: 'unknown', risk: 'review', activity: 'listening' })}
          />
          <FindingRow
            tone={(snapshot?.summary.internetProcesses ?? 0) ? 'warning' : 'good'}
            label={(snapshot?.summary.internetProcesses ?? 0) ? 'Internet activity is live' : 'No internet processes'}
            detail={`${snapshot?.summary.internetProcesses ?? 0} process${(snapshot?.summary.internetProcesses ?? 0) === 1 ? '' : 'es'} · ${formatBps(snapshot?.summary.networkDownloadBps ?? null, snapshot ? 'available' : 'measuring')} down`}
            onClick={() => onNavigate('network', { activity: 'internet' })}
          />
          <FindingRow
            tone={(snapshot?.summary.cleanCandidates ?? 0) ? 'warning' : 'good'}
            label={(snapshot?.summary.cleanCandidates ?? 0) ? 'Cleanup can be reviewed' : 'No cleanup queue'}
            detail={`${snapshot?.summary.cleanCandidates ?? 0} candidate${(snapshot?.summary.cleanCandidates ?? 0) === 1 ? '' : 's'} · ${snapshot?.summary.cleanableMemoryMb ?? 0} MB`}
            onClick={() => onNavigate('cleanup', { activity: 'cleanup' })}
          />
        </div>

        <div className="health-sample">
          <span>Last sample</span>
          <strong>{snapshot ? formatSampleTime(snapshot.generatedAt) : 'Measuring'}</strong>
          <small>{snapshot?.summary.cpuTotal ?? 0}% CPU · {snapshot?.summary.externalConnections ?? 0} internet connections</small>
        </div>
      </section>

      <section className="scope-strip" aria-label="Primary scopes">
        <ScopeButton
          label="All Processes"
          value={snapshot?.summary.totalProcesses ?? 0}
          detail={`${snapshot?.summary.userProcesses ?? 0} user-owned`}
          icon={Monitor}
          onClick={() => onNavigate('processes')}
        />
        <ScopeButton
          label="Local Services"
          value={snapshot?.summary.listeningPorts ?? 0}
          detail={`${snapshot?.summary.localServers ?? 0} processes`}
          icon={Server}
          onClick={() => onNavigate('services')}
        />
        <ScopeButton
          label="Internet"
          value={snapshot?.summary.internetProcesses ?? 0}
          detail={`${snapshot?.summary.externalConnections ?? 0} connections`}
          icon={Network}
          onClick={() => onNavigate('network')}
        />
        <ScopeButton
          label="Cleanup"
          value={snapshot?.summary.cleanCandidates ?? 0}
          detail={`${snapshot?.summary.cleanableMemoryMb ?? 0} MB reviewable`}
          icon={ListChecks}
          onClick={() => onNavigate('cleanup')}
        />
      </section>

      <SignalStrip snapshot={snapshot} />

      <section className="dashboard-grid">
        <DashboardModule title="Needs Review" action="Processes" onAction={() => onNavigate('processes', { risk: 'review' })}>
          {topReview.length ? (
            topReview.map((process) => (
              <button className="review-row" type="button" key={`review-${process.pid}`} onClick={() => onSelect(process.pid)}>
                <StatusDot risk={process.riskLevel} />
                <div>
                  <strong>{process.name}</strong>
                  <span>{reviewReason(process)}</span>
                </div>
                <small>{process.category === 'unknown' ? 'Unknown' : CATEGORY_LABELS[process.category]}</small>
              </button>
            ))
          ) : (
            <Empty label="No processes need review" />
          )}
        </DashboardModule>

        <DashboardModule title="Internet Activity" action="Network" onAction={() => onNavigate('network', { activity: 'internet' })}>
          {networkProcesses.slice(0, 5).map((process) => (
              <button className="review-row" type="button" key={`net-${process.pid}`} onClick={() => onSelect(process.pid, 'network')}>
              <StatusDot risk={process.riskLevel} />
              <div>
                <strong>{process.name}</strong>
                <span>{remoteDestinationsText(process) || connectionsText(process)}</span>
              </div>
              <small>{formatBps(process.network.downloadBps, process.network.status)}</small>
            </button>
          ))}
          {!networkProcesses.length ? <Empty label="No internet-connected processes" /> : null}
        </DashboardModule>

        <DashboardModule title="Exposed Local Services" action="Services" onAction={() => onNavigate('services', { activity: 'listening' })}>
          {localServices.slice(0, 5).map((process) => (
              <button className="review-row" type="button" key={`svc-${process.pid}`} onClick={() => onSelect(process.pid, 'services')}>
              <StatusDot risk={process.riskLevel} />
              <div>
                <strong>{localUrlText(process) || process.name}</strong>
                <span>{process.name} · {bindScopeText(process)} · {process.serviceGroup.label}</span>
              </div>
              <small>{portsText(process)}</small>
            </button>
          ))}
          {!localServices.length ? <Empty label="No listening local services" /> : null}
        </DashboardModule>
      </section>

      <section className="dashboard-grid secondary">
        <DashboardModule title="Cleanup Queue" action="Review" onAction={() => onNavigate('cleanup', { activity: 'cleanup' })}>
          {cleanCandidates.slice(0, 5).map((process) => (
              <button className="review-row" type="button" key={`clean-${process.pid}`} onClick={() => onSelect(process.pid, 'cleanup')}>
              <StatusDot risk={process.riskLevel} />
              <div>
                <strong>{process.name}</strong>
                <span>{cleanupReason(process)}</span>
              </div>
              <small>{Math.round(process.rssKb / 1024)} MB</small>
            </button>
          ))}
          {!cleanCandidates.length ? <Empty label="No cleanup candidates" /> : null}
        </DashboardModule>

        <section className="connectivity-card activity-module">
          <div>
            <div className="panel-heading">
              <h3>Recent Network Sample</h3>
              <span>{formatBps(snapshot?.summary.networkDownloadBps ?? null, snapshot ? 'available' : 'measuring')} down</span>
            </div>
            <ConnectivityHistory values={connectivityHistory} />
          </div>
        </section>

        <DashboardModule title="High Load" action="Processes" onAction={() => onNavigate('processes')}>
          {highLoad.slice(0, 5).map((process) => (
            <button className="review-row" type="button" key={`load-${process.pid}`} onClick={() => onSelect(process.pid)}>
              <StatusDot risk={process.riskLevel} />
              <div>
                <strong>{process.name}</strong>
                <span>{process.description}</span>
              </div>
              <small>{process.cpuPercent}%</small>
            </button>
          ))}
          {!highLoad.length ? <Empty label="No high load processes" /> : null}
        </DashboardModule>
      </section>
    </div>
  );
}

function FindingRow({ tone, label, detail, onClick }: { tone: 'good' | 'warning' | 'critical'; label: string; detail: string; onClick: () => void }): JSX.Element {
  return (
    <button className={`finding-row ${tone}`} type="button" onClick={onClick}>
      <StatusDot risk={tone === 'good' ? 'low' : tone === 'critical' ? 'high' : 'medium'} />
      <span>{label}</span>
      <strong>{detail}</strong>
    </button>
  );
}

function ScopeButton({
  label,
  value,
  detail,
  icon: Icon,
  onClick
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Activity;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className="scope-button" type="button" onClick={onClick}>
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function DashboardModule({ title, action, onAction, children }: { title: string; action: string; onAction: () => void; children: ReactNode }): JSX.Element {
  return (
    <section className="dashboard-module">
      <div className="panel-heading">
        <h3>{title}</h3>
        <button type="button" onClick={onAction}>
          {action}
        </button>
      </div>
      <div className="module-list">{children}</div>
    </section>
  );
}

function SignalStrip({ snapshot }: { snapshot: ProcessSnapshot | null }): JSX.Element {
  const summary = snapshot?.summary;
  const networkAvailable = Boolean(summary && (summary.networkDownloadBps !== null || summary.networkUploadBps !== null));
  const networkBps = networkAvailable ? (summary?.networkDownloadBps ?? 0) + (summary?.networkUploadBps ?? 0) : null;

  return (
    <section className="signal-strip" aria-label="System signals">
      <SignalItem label="CPU total" value={`${summary?.cpuTotal ?? 0}%`} tone={(summary?.cpuTotal ?? 0) >= 75 ? 'critical' : (summary?.cpuTotal ?? 0) >= 35 ? 'warning' : 'good'} />
      <SignalItem label="Memory seen" value={`${summary?.memoryTotalMb ?? 0} MB`} tone="neutral" />
      <SignalItem label="Cleanable" value={`${summary?.cleanableMemoryMb ?? 0} MB`} tone={(summary?.cleanCandidates ?? 0) ? 'warning' : 'good'} />
      <SignalItem label="Network" value={formatBps(networkBps, summary ? (networkAvailable ? 'available' : 'unavailable') : 'measuring')} tone={networkBps ? 'warning' : 'neutral'} />
    </section>
  );
}

function SignalItem({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warning' | 'critical' | 'neutral' }): JSX.Element {
  return (
    <div className={`signal-item ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricButton({
  label,
  value,
  detail,
  icon: Icon,
  onClick
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Activity;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className="metric metric-button" type="button" onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function StatusPanel({ title, value, detail }: { title: string; value: string | number; detail: string }): JSX.Element {
  return (
    <div className="panel status-mini">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ConnectivityHistory({ values }: { values: number[] }): JSX.Element {
  return (
    <div className="connectivity-grid" aria-label="Connectivity history">
      {values.map((value, index) => (
        <span className={value ? 'active' : 'idle'} key={`${index}-${value}`} />
      ))}
    </div>
  );
}

function FilterBar({
  filters,
  activeCount,
  onChange,
  onClear
}: {
  filters: ProcessFilters;
  activeCount: number;
  onChange: (patch: Partial<ProcessFilters>) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <section className="filter-bar" aria-label="Process filters">
      <FilterGroup
        label="Kind"
        value={filters.category}
        options={[
          ['all', 'All'],
          ['local-server', 'Servers'],
          ['ai-agent', 'Agents'],
          ['developer-tool', 'Dev tools'],
          ['database', 'Databases'],
          ['unknown', 'Unknown']
        ]}
        onChange={(category) => onChange({ category: category as CategoryFilter })}
      />
      <FilterGroup
        label="Risk"
        value={filters.risk}
        options={[
          ['all', 'All'],
          ['review', 'Review'],
          ['high', 'High']
        ]}
        onChange={(risk) => onChange({ risk: risk as RiskFilter })}
      />
      <FilterGroup
        label="Activity"
        value={filters.activity}
        options={[
          ['all', 'All'],
          ['internet', 'Internet'],
          ['listening', 'Ports'],
          ['cleanup', 'Cleanup'],
          ['high-traffic', 'High traffic'],
          ['non-local', 'Non-local']
        ]}
        onChange={(activity) => onChange({ activity: activity as ActivityFilter })}
      />
      <button className="filter-clear" type="button" onClick={onClear} disabled={!activeCount}>
        Clear
      </button>
    </section>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="filter-group">
      <span>{label}</span>
      <div className="filter-segment" role="radiogroup" aria-label={label}>
        {options.map(([optionValue, optionLabel]) => (
          <button
            className={value === optionValue ? 'active' : ''}
            type="button"
            key={optionValue}
            onClick={() => onChange(optionValue)}
            aria-pressed={value === optionValue}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function ListPanel({
  title,
  rows,
  value,
  onSelect
}: {
  title: string;
  rows: ProcessInfo[];
  value: (process: ProcessInfo) => string;
  onSelect: (pid: number) => void;
}): JSX.Element {
  return (
    <div className="panel">
      <div className="panel-heading">
        <h3>{title}</h3>
      </div>
      {rows.length ? (
        rows.map((process) => (
          <button className="list-row" type="button" key={process.pid} onClick={() => onSelect(process.pid)}>
            <StatusDot risk={process.riskLevel} />
            <span>{process.name}</span>
            <strong>{value(process) || '-'}</strong>
          </button>
        ))
      ) : (
        <Empty label="No items" />
      )}
    </div>
  );
}

function ProcessTable({
  view,
  processes,
  selectedPid,
  sortKey,
  sortDirection,
  cleanupSelection,
  onSort,
  onSelect,
  onToggleCleanup,
  onTerminateSelection,
  onReviewSelectedNetwork,
  onOpenService
}: {
  view: ViewId;
  processes: ProcessInfo[];
  selectedPid: number | null;
  sortKey: SortKey;
  sortDirection: 'asc' | 'desc';
  cleanupSelection: Set<number>;
  onSort: (key: SortKey) => void;
  onSelect: (pid: number) => void;
  onToggleCleanup: (pid: number) => void;
  onTerminateSelection: () => void;
  onReviewSelectedNetwork: () => void;
  onOpenService: (process: ProcessInfo) => void;
}): JSX.Element {
  const isCleanup = view === 'cleanup';
  const isServices = view === 'services';
  const isNetwork = view === 'network';
  const selectedProcess = processes.find((process) => process.pid === selectedPid);

  return (
    <section className={isCleanup ? 'table-panel cleanup-table' : 'table-panel'}>
      {isCleanup ? <CleanupSummary processes={processes} cleanupSelection={cleanupSelection} /> : null}

      {isCleanup || isNetwork ? (
        <div className="table-actionbar">
          <span>
            {isCleanup
              ? cleanupSelection.size
                ? `${cleanupSelection.size} selected · nothing stops until confirmation`
                : `${processes.length} candidates · review before stopping`
              : `${processes.length} internet-connected processes · inspect before stopping`}
          </span>
          {isCleanup ? (
            <button type="button" onClick={onTerminateSelection}>
              {cleanupSelection.size ? 'Review cleanup' : 'Select recommended'}
            </button>
          ) : (
            <button className="danger-button actionbar-danger" type="button" onClick={onReviewSelectedNetwork} disabled={!selectedProcess?.safeToTerminate}>
              Review termination
            </button>
          )}
        </div>
      ) : null}

      <div className="table-scroll">
        <table>
          <colgroup>
            {isCleanup ? <col className="col-check" /> : null}
            <col className="col-name" />
            <col className="col-kind" />
            {isNetwork ? <col className="col-remote" /> : <col className="col-description" />}
            {isNetwork ? <col className="col-speed" /> : <col className="col-usage" />}
            {isNetwork ? <col className="col-speed" /> : <col className="col-usage" />}
            {isNetwork ? <col className="col-connections" /> : <col className="col-ports" />}
            <col className="col-uptime" />
            {isServices ? <col className="col-open" /> : null}
          </colgroup>
          <thead>
            <tr>
              {isCleanup ? <th /> : null}
              <SortableHeader label="Name" sortKey="name" active={sortKey} direction={sortDirection} onSort={onSort} />
              <SortableHeader label="Kind" sortKey="category" active={sortKey} direction={sortDirection} onSort={onSort} />
              {isNetwork ? (
                <th>Remote</th>
              ) : isCleanup ? (
                <th className="summary-column">Reason</th>
              ) : isServices ? (
                <th className="summary-column">Local URL</th>
              ) : (
                <th className="summary-column">Summary</th>
              )}
              {isNetwork ? (
                <SortableHeader label="Down" sortKey="networkDownloadBps" active={sortKey} direction={sortDirection} onSort={onSort} />
              ) : (
                <SortableHeader label="CPU" sortKey="cpuPercent" active={sortKey} direction={sortDirection} onSort={onSort} />
              )}
              {isNetwork ? (
                <SortableHeader label="Up" sortKey="networkUploadBps" active={sortKey} direction={sortDirection} onSort={onSort} />
              ) : (
                <SortableHeader label="Mem" sortKey="rssKb" active={sortKey} direction={sortDirection} onSort={onSort} />
              )}
              {isNetwork ? (
                <SortableHeader label="Conn" sortKey="connections" active={sortKey} direction={sortDirection} onSort={onSort} />
              ) : (
                <SortableHeader label="Ports" sortKey="ports" active={sortKey} direction={sortDirection} onSort={onSort} />
              )}
              <SortableHeader label="Age" sortKey="uptimeSeconds" active={sortKey} direction={sortDirection} onSort={onSort} />
              {isServices ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {processes.map((process) => (
              <tr key={process.pid} className={selectedPid === process.pid ? 'selected' : ''} onClick={() => onSelect(process.pid)}>
                {isCleanup ? (
                  <td onClick={(event) => event.stopPropagation()}>
                    <button
                      className={cleanupSelection.has(process.pid) ? 'check-button checked' : 'check-button'}
                      type="button"
                      aria-label={`Select ${process.name}`}
                      onClick={() => onToggleCleanup(process.pid)}
                    >
                      {cleanupSelection.has(process.pid) ? <Check size={13} /> : null}
                    </button>
                  </td>
                ) : null}
                <td>
                  <div className="process-cell">
                    <StatusDot risk={process.riskLevel} />
                    <div>
                      <strong>{process.name}</strong>
                      <span>
                        {process.user} · PID {process.pid} · {process.serviceGroup.label}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="kind-stack">
                    <CategoryBadge category={process.category} />
                    <span>{confidenceLabel(process)} confidence</span>
                  </div>
                </td>
                {isNetwork ? (
                  <td className="network-remote">{remoteDestinationsText(process) || networkServicesText(process)}</td>
                ) : isCleanup ? (
                  <td className="summary-column">
                    <span className="description">{cleanupReason(process)}</span>
                  </td>
                ) : isServices ? (
                  <td className="summary-column">
                    <span className="description">{localServiceSummary(process)}</span>
                  </td>
                ) : (
                  <td className="summary-column">
                    <span className="description">{process.description}</span>
                  </td>
                )}
                {isNetwork ? (
                  <td className="mono muted">{formatBps(process.network.downloadBps, process.network.status)}</td>
                ) : (
                  <td>
                    <Usage value={process.cpuPercent} max={80} suffix="%" />
                  </td>
                )}
                {isNetwork ? (
                  <td className="mono muted">{formatBps(process.network.uploadBps, process.network.status)}</td>
                ) : (
                  <td>
                    <Usage value={Math.round(process.rssKb / 1024)} max={2048} suffix=" MB" />
                  </td>
                )}
                <td className="mono muted">{isNetwork ? process.networkConnections.length : portsText(process) || '-'}</td>
                <td className="mono muted">{formatDuration(process.uptimeSeconds)}</td>
                {isServices ? (
                  <td onClick={(event) => event.stopPropagation()}>
                    <button className="small-icon-button" type="button" onClick={() => onOpenService(process)} aria-label={`Open ${process.name}`}>
                      <ExternalLink size={14} />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!processes.length ? <Empty label={isNetwork ? 'No internet-connected processes' : 'No matching processes'} /> : null}
      </div>
    </section>
  );
}

function CleanupSummary({ processes, cleanupSelection }: { processes: ProcessInfo[]; cleanupSelection: Set<number> }): JSX.Element {
  const rows = cleanupSelection.size ? processes.filter((process) => cleanupSelection.has(process.pid)) : processes;
  const memoryMb = Math.round(rows.reduce((total, process) => total + process.rssKb, 0) / 1024);
  const cpu = round(rows.reduce((total, process) => total + process.cpuPercent, 0));
  const label = cleanupSelection.size ? 'Selected' : 'Cleanable';

  return (
    <div className="cleanup-summary">
      <SummaryTile label={`${label} processes`} value={rows.length} />
      <SummaryTile label={`${label} memory`} value={`${memoryMb} MB`} />
      <SummaryTile label={`${label} CPU`} value={`${cpu}%`} />
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  direction,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}): JSX.Element {
  return (
    <th>
      <button className="sort-header" type="button" onClick={() => onSort(sortKey)}>
        <span>{label}</span>
        {active === sortKey ? direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  );
}

function Inspector({
  process,
  aiExplanation,
  aiLoading,
  trend,
  ruleState,
  onExplain,
  onTerminate,
  onOpenService,
  onRuleChange,
  onExportDiagnostics
}: {
  process: ProcessInfo | null;
  aiExplanation: AiExplanation | null;
  aiLoading: boolean;
  trend: ProcessTrendSummary | null;
  ruleState: 'keep' | 'flag' | 'none';
  onExplain: () => void;
  onTerminate: () => void;
  onOpenService: (process: ProcessInfo) => void;
  onRuleChange: (process: ProcessInfo, action: 'keep' | 'flag' | 'clear') => void;
  onExportDiagnostics: () => void;
}): JSX.Element {
  if (!process) {
    return <Empty label="No process selected" />;
  }

  return (
    <div className="inspector-scroll">
      <div className="inspector-header">
        <StatusDot risk={process.riskLevel} />
        <div>
          <h2>{process.name}</h2>
          <p>PID {process.pid} · {process.user}</p>
        </div>
      </div>

      <InspectorGroup title="Assessment">
        <StatusLine label="Classification" value={process.cleanCandidate ? 'Likely safe to stop' : CATEGORY_LABELS[process.category]} />
        <StatusLine label="Confidence" value={confidenceLabel(process)} />
        <StatusLine label="Termination guard" value={process.safeToTerminate ? 'Review required' : 'Protected'} />
        <StatusLine label="Why flagged" value={reviewReason(process)} />
        <StatusLine label="User rule" value={ruleState === 'keep' ? 'Always keep' : ruleState === 'flag' ? 'Always flag' : 'None'} />
      </InspectorGroup>

      <InspectorGroup title="Origin">
        <StatusLine label="Executable" value={process.provenance.executableName} />
        <StatusLine label="Parent" value={process.provenance.parentName ? `${process.provenance.parentName} (${process.provenance.parentPid})` : String(process.provenance.parentPid)} />
        <StatusLine label="Launch" value={process.provenance.launchMethod} />
        <StatusLine label="Project" value={process.provenance.projectPath ?? 'Not detected'} />
        <StatusLine label="Group" value={`${process.serviceGroup.label} · ${process.serviceGroup.kind}`} />
      </InspectorGroup>

      <div className="action-stack">
        <button className="primary-button" type="button" onClick={onExplain} disabled={aiLoading}>
          <Sparkles size={15} />
          {aiLoading ? 'Explaining' : 'Explain on demand'}
        </button>
        {process.ports.length ? (
          <button className="open-service-button" type="button" onClick={() => onOpenService(process)}>
            <ExternalLink size={15} />
            Open {localUrlText(process)}
          </button>
        ) : null}
      </div>

      <InspectorGroup title="Resource Use">
        <StatusLine label="CPU" value={`${process.cpuPercent}%`} />
        <StatusLine label="Memory" value={`${Math.round(process.rssKb / 1024)} MB`} />
        <StatusLine label="Download" value={formatBps(process.network.downloadBps, process.network.status)} />
        <StatusLine label="Upload" value={formatBps(process.network.uploadBps, process.network.status)} />
        <StatusLine label="Uptime" value={formatDuration(process.uptimeSeconds)} />
        <StatusLine label="24h trend" value={trend ? `${trend.samples} samples · avg ${trend.avgCpu}% CPU` : 'Collecting'} />
      </InspectorGroup>

      <InspectorGroup title="Expected Gain">
        <StatusLine label="Memory" value={`${Math.round(process.rssKb / 1024)} MB`} />
        <StatusLine label="CPU now" value={`${process.cpuPercent}%`} />
        <StatusLine label="Peak CPU" value={trend ? `${trend.peakCpu}%` : 'Collecting'} />
        <StatusLine label="Peak network" value={trend ? `${formatBytes(trend.peakTrafficBps)}/s` : 'Collecting'} />
      </InspectorGroup>

      <InspectorSection title="Description">
        <p>{process.description}</p>
        <div className="chip-row">
          <CategoryBadge category={process.category} />
          {process.tags.map((tag) => (
            <span className="chip" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="Evidence">
        <ul className="evidence-list">
          {process.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li>Command starts with {process.provenance.commandPreview}</li>
        </ul>
        <div className="rule-actions">
          <button type="button" onClick={() => onRuleChange(process, 'keep')}>Always keep</button>
          <button type="button" onClick={() => onRuleChange(process, 'flag')}>Always flag</button>
          <button type="button" onClick={() => onRuleChange(process, 'clear')} disabled={ruleState === 'none'}>Clear rule</button>
        </div>
      </InspectorSection>

      <InspectorSection title="Network">
        {process.networkConnections.length ? (
          <>
            <p>{process.networkConnections.length} active internet connection{process.networkConnections.length === 1 ? '' : 's'}.</p>
            <div className="connection-list">
              {process.networkConnections.slice(0, 8).map((connection) => (
                <div className="connection-row" key={`${connection.localPort}-${connection.remoteAddress}-${connection.remotePort}`}>
                  <span>{connection.service}</span>
                  <strong>{remoteConnectionLabel(connection)}</strong>
                  <small>{connection.direction} · {connection.remoteScope} · {connection.encryptedLikely ? 'likely encrypted' : 'encryption unknown'}</small>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>No active public internet TCP connection detected.</p>
        )}
      </InspectorSection>

      <InspectorSection title="Ports">
        {process.ports.length ? (
          <div className="chip-row">
            {process.ports.map((port) => (
              <span className="chip mono" key={`${port.address}:${port.port}`}>
                {port.address}:{port.port}
              </span>
            ))}
          </div>
        ) : (
          <p>No listening TCP ports.</p>
        )}
      </InspectorSection>

      {aiExplanation ? (
        <InspectorSection title="AI Explanation">
          <p>{sanitizeAiText(aiExplanation.summary)}</p>
          <dl className="ai-list">
            <div>
              <dt>Activity</dt>
              <dd>{sanitizeAiText(aiExplanation.activity)}</dd>
            </div>
            <div>
              <dt>Resources</dt>
              <dd>{sanitizeAiText(aiExplanation.resourceReason)}</dd>
            </div>
            <div>
              <dt>Quit</dt>
              <dd>{sanitizeAiText(aiExplanation.safeToQuit)}</dd>
            </div>
            <div>
              <dt>Next</dt>
              <dd>{sanitizeAiText(aiExplanation.recommendedAction)}</dd>
            </div>
          </dl>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Termination">
        <p>{process.safeToTerminate ? 'MetalExplorer will ask for confirmation before stopping this user-owned process.' : 'This process is protected from termination in MetalExplorer.'}</p>
        <button className="danger-button termination-button" type="button" onClick={onTerminate} disabled={!process.safeToTerminate}>
          <Power size={15} />
          Review termination
        </button>
      </InspectorSection>

      <InspectorSection title="Report">
        <p>Export a local classification report when this process is mislabeled or needs review.</p>
        <button className="secondary-button full-width-button" type="button" onClick={onExportDiagnostics}>
          <FileDown size={15} />
          Export classification report
        </button>
      </InspectorSection>

      <InspectorSection title="Command">
        <code>{process.command}</code>
      </InspectorSection>
    </div>
  );
}

function TerminationReview({
  process,
  onCancel,
  onConfirm
}: {
  process: ProcessInfo;
  onCancel: () => void;
  onConfirm: (pid: number) => void;
}): JSX.Element {
  return (
    <div className="review-overlay" role="presentation" onMouseDown={onCancel}>
      <section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="termination-review-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-sheet-header">
          <StatusDot risk={process.riskLevel} />
          <div>
            <h2 id="termination-review-title">Review Termination</h2>
            <p>{process.name} · PID {process.pid}</p>
          </div>
        </div>

        <InspectorGroup title="What Will Stop">
          <StatusLine label="Process" value={process.name} />
          <StatusLine label="Owner" value={process.user} />
          <StatusLine label="Launch" value={process.provenance.launchMethod} />
          <StatusLine label="Guard" value={process.safeToTerminate ? 'User-owned and eligible' : 'Protected'} />
        </InspectorGroup>

        <InspectorSection title="Impact Preview">
          <ul className="evidence-list">
            <li>{process.ports.length ? `${process.ports.length} listening port${process.ports.length === 1 ? '' : 's'} may close: ${portsText(process)}` : 'No listening TCP ports detected.'}</li>
            <li>{process.networkConnections.length ? `${connectionsText(process)} will be interrupted: ${remoteDestinationsText(process)}.` : 'No public internet TCP connection detected.'}</li>
            <li>{process.cleanCandidate ? cleanupReason(process) : reviewReason(process)}</li>
          </ul>
        </InspectorSection>

        <InspectorSection title="Evidence">
          <ul className="evidence-list">
            {process.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </InspectorSection>

        <div className="review-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={() => onConfirm(process.pid)} disabled={!process.safeToTerminate}>
            <CircleStop size={15} />
            Stop Process
          </button>
        </div>
      </section>
    </div>
  );
}

function CleanupReview({
  processes,
  onCancel,
  onConfirm
}: {
  processes: ProcessInfo[];
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const memoryMb = Math.round(processes.reduce((total, process) => total + process.rssKb, 0) / 1024);
  const cpu = round(processes.reduce((total, process) => total + process.cpuPercent, 0));
  const portCount = processes.reduce((total, process) => total + process.ports.length, 0);

  return (
    <div className="review-overlay" role="presentation" onMouseDown={onCancel}>
      <section className="review-sheet cleanup-review-sheet" role="dialog" aria-modal="true" aria-labelledby="cleanup-review-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-sheet-header">
          <ListChecks size={18} />
          <div>
            <h2 id="cleanup-review-title">Review Cleanup</h2>
            <p>{processes.length} selected candidate{processes.length === 1 ? '' : 's'}</p>
          </div>
        </div>

        <div className="cleanup-summary compact">
          <SummaryTile label="Memory" value={`${memoryMb} MB`} />
          <SummaryTile label="CPU" value={`${cpu}%`} />
          <SummaryTile label="Ports" value={portCount} />
        </div>

        <div className="review-process-list">
          {processes.map((process) => (
            <div className="review-process-row" key={process.pid}>
              <StatusDot risk={process.riskLevel} />
              <div>
                <strong>{process.name}</strong>
                <span>{cleanupReason(process)}</span>
              </div>
              <small>PID {process.pid}</small>
            </div>
          ))}
        </div>

        <div className="review-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={!processes.length}>
            <CircleStop size={15} />
            Stop Selected
          </button>
        </div>
      </section>
    </div>
  );
}

function CommandPalette({
  query,
  process,
  onQueryChange,
  onClose,
  onNavigate,
  onExplain,
  onTerminate,
  onOpenService
}: {
  query: string;
  process: ProcessInfo | null;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onNavigate: (view: ViewId, filters?: Partial<ProcessFilters>) => void;
  onExplain: () => void;
  onTerminate: () => void;
  onOpenService: (process: ProcessInfo) => void;
}): JSX.Element {
  const commands: Array<{ label: string; detail: string; icon: typeof Activity; disabled?: boolean; run: () => void }> = [
    { label: 'Dashboard', detail: 'Open system health', icon: Monitor, run: () => onNavigate('dashboard') },
    { label: 'Review unknown listeners', detail: 'Open filtered services', icon: Server, run: () => onNavigate('services', { category: 'unknown', risk: 'review', activity: 'listening' }) },
    { label: 'Review internet activity', detail: 'Open filtered network', icon: Network, run: () => onNavigate('network', { activity: 'internet' }) },
    { label: 'Review cleanup queue', detail: 'Open cleanup candidates', icon: ListChecks, run: () => onNavigate('cleanup', { activity: 'cleanup' }) },
    { label: 'High traffic', detail: 'Open high-throughput processes', icon: Activity, run: () => onNavigate('network', { activity: 'high-traffic' }) },
    { label: 'Explain selected', detail: process ? process.name : 'No process selected', icon: Sparkles, disabled: !process, run: onExplain },
    { label: 'Review termination', detail: process ? process.name : 'No process selected', icon: Power, disabled: !process?.safeToTerminate, run: onTerminate },
    { label: 'Open selected service', detail: process?.ports.length ? localUrlText(process) : 'No local port selected', icon: ExternalLink, disabled: !process?.ports.length, run: () => process && onOpenService(process) }
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCommands = commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(normalizedQuery));

  return (
    <div className="review-overlay command-overlay" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <label className="command-input">
          <Command size={16} />
          <input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search actions" />
        </label>
        <div className="command-list">
          {visibleCommands.map((command) => {
            const Icon = command.icon;
            return (
              <button
                type="button"
                key={command.label}
                disabled={command.disabled}
                onClick={() => {
                  if (!command.disabled) {
                    command.run();
                  }
                }}
              >
                <Icon size={15} />
                <span>{command.label}</span>
                <small>{command.detail}</small>
              </button>
            );
          })}
          {!visibleCommands.length ? <Empty label="No matching actions" /> : null}
        </div>
      </section>
    </div>
  );
}

function SystemInspector({
  snapshot,
  processes,
  highLoad,
  localServices,
  cleanCandidates,
  networkProcesses,
  onNavigate
}: {
  snapshot: ProcessSnapshot | null;
  processes: ProcessInfo[];
  highLoad: ProcessInfo[];
  localServices: ProcessInfo[];
  cleanCandidates: ProcessInfo[];
  networkProcesses: ProcessInfo[];
  onNavigate: (view: ViewId, filters?: Partial<ProcessFilters>) => void;
}): JSX.Element {
  const status = getSystemStatus(snapshot, processes);
  const reviewQueue = buildReviewQueue(processes, highLoad, localServices, cleanCandidates, networkProcesses);

  return (
    <div className="inspector-scroll">
      <div className="inspector-header">
        <Shield size={18} />
        <div>
          <h2>System Review</h2>
          <p>{snapshot ? formatSampleTime(snapshot.generatedAt) : 'Measuring'}</p>
        </div>
      </div>

      <InspectorGroup title="Status">
        <StatusLine label="Health" value={status.label} />
        <StatusLine label="Review items" value={String(reviewQueue.length)} />
        <StatusLine label="Internet" value={`${snapshot?.summary.internetProcesses ?? 0} processes`} />
        <StatusLine label="Cleanup queue" value={`${snapshot?.summary.cleanCandidates ?? 0} candidates`} />
      </InspectorGroup>

      <InspectorSection title="Top Findings">
        <div className="inspector-action-list">
          <button type="button" onClick={() => onNavigate('services', { category: 'unknown', risk: 'review', activity: 'listening' })}>
            <span>Unknown listeners</span>
            <strong>{snapshot?.summary.unknownNetworkListeners ?? 0}</strong>
          </button>
          <button type="button" onClick={() => onNavigate('network', { activity: 'internet' })}>
            <span>Internet processes</span>
            <strong>{snapshot?.summary.internetProcesses ?? 0}</strong>
          </button>
          <button type="button" onClick={() => onNavigate('cleanup', { activity: 'cleanup' })}>
            <span>Cleanup candidates</span>
            <strong>{snapshot?.summary.cleanCandidates ?? 0}</strong>
          </button>
        </div>
      </InspectorSection>

      <InspectorSection title="Privacy">
        <p>Process data stays local unless you explicitly use Explain on demand for a selected process.</p>
        <div className="chip-row">
          <span className="chip">Local first</span>
          <span className="chip">On-demand AI</span>
        </div>
      </InspectorSection>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }): JSX.Element {
  return (
    <div className="stat">
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InspectorGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="inspector-group">
      <h3>{title}</h3>
      <div className="inspector-rows">{children}</div>
    </section>
  );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function SettingsPanel({
  settings,
  userRules,
  onRulesChange,
  onClearLocalLearning,
  onSaved
}: {
  settings: AppSettings | null;
  userRules: UserRules;
  onRulesChange: (rules: UserRules) => void;
  onClearLocalLearning: () => void;
  onSaved: (settings: AppSettings) => void;
}): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(settings?.model ?? 'gpt-4.1-mini');
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(settings?.rememberApiKey ?? false);
  const [refreshMs, setRefreshMs] = useState(settings?.refreshMs ?? 3000);
  const [theme, setTheme] = useState<ThemeName>(settings?.theme ?? 'light');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setRememberApiKey(settings.rememberApiKey);
    setRefreshMs(settings.refreshMs);
    setTheme(settings.theme);
  }, [settings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const next = await window.metalExplorer.updateSettings({
      baseUrl,
      model,
      refreshMs,
      rememberApiKey,
      theme,
      apiKey
    });
    setApiKey('');
    setSaving(false);
    onSaved(next);
  }

  async function clearKey(): Promise<void> {
    onSaved(await window.metalExplorer.updateSettings({ clearApiKey: true }));
  }

  return (
    <form className="settings-panel scroll-area" onSubmit={(event) => void handleSubmit(event)}>
      <section className="settings-section">
        <h2>Appearance</h2>
        <div className="settings-row">
          <div>
            <strong>Theme</strong>
            <span>Choose the local app appearance.</span>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {(Object.keys(THEME_LABELS) as ThemeName[]).map((themeName) => (
              <button
                className={theme === themeName ? 'theme-option active' : 'theme-option'}
                type="button"
                key={themeName}
                onClick={() => setTheme(themeName)}
              >
                <span>{THEME_LABELS[themeName]}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>AI Provider</h2>
        <p className="settings-note">AI explanations are on demand. Process data is sent only when you click Explain for a selected process.</p>
        <label className="settings-row">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label className="settings-row">
          <span>Model</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="settings-row">
          <span>API Key</span>
          <input value={apiKey} type="password" placeholder={settings?.hasApiKey ? 'Saved locally' : 'Paste key for this Mac'} onChange={(event) => setApiKey(event.target.value)} />
        </label>
        <label className="settings-row toggle-setting">
          <span>Remember key locally</span>
          <input checked={rememberApiKey} type="checkbox" onChange={(event) => setRememberApiKey(event.target.checked)} />
        </label>
      </section>

      <section className="settings-section">
        <h2>Local App</h2>
        <label className="settings-row">
          <span>Refresh interval</span>
          <input value={refreshMs} type="number" min={1000} max={30000} step={500} onChange={(event) => setRefreshMs(Number(event.target.value))} />
        </label>
        <div className="settings-row readonly-row">
          <span>Storage</span>
          <strong>{settings?.encryptionAvailable ? 'Encrypted local storage available' : 'Encrypted storage unavailable'}</strong>
        </div>
      </section>

      <section className="settings-section">
        <h2>Local Rules</h2>
        <div className="settings-row">
          <div>
            <strong>Profile</strong>
            <span>Adjust how strongly MetalExplorer flags local activity.</span>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Rule profile">
            {RULE_PRESETS.map((preset) => (
              <button
                className={userRules.preset === preset.id ? 'theme-option active' : 'theme-option'}
                type="button"
                key={preset.id}
                onClick={() => onRulesChange({ ...userRules, preset: preset.id })}
              >
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row readonly-row">
          <span>User rules</span>
          <strong>{userRules.keep.length} keep · {userRules.flag.length} flag</strong>
        </div>
        <div className="settings-row readonly-row">
          <span>Local learning</span>
          <button className="secondary-button" type="button" onClick={onClearLocalLearning}>
            Clear local trends and rules
          </button>
        </div>
      </section>

      <div className="settings-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          <Settings size={15} />
          {saving ? 'Saving' : 'Save Settings'}
        </button>
        <button className="secondary-button" type="button" onClick={() => void clearKey()} disabled={!settings?.hasApiKey}>
          Clear Key
        </button>
      </div>
    </form>
  );
}

function PrivacyPanel({ settings }: { settings: AppSettings | null }): JSX.Element {
  return (
    <div className="inspector-scroll">
      <div className="inspector-header">
        <Lock size={20} />
        <div>
          <h2>Privacy</h2>
          <p>Local preferences</p>
        </div>
      </div>
      <div className="privacy-list">
        <StatusLine label="API key" value={settings?.hasApiKey ? 'Present' : 'Not set'} />
        <StatusLine label="Encrypted storage" value={settings?.encryptionAvailable ? 'Available' : 'Unavailable'} />
        <StatusLine label="Remember key" value={settings?.rememberApiKey ? 'On' : 'Off'} />
        <StatusLine label="Theme" value={settings ? THEME_LABELS[settings.theme] : 'Light'} />
        <StatusLine label="AI calls" value="On demand" />
      </div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ tone, label }: { tone: 'good' | 'warning' | 'critical' | 'neutral'; label: string }): JSX.Element {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}

function CategoryBadge({ category }: { category: ProcessCategory }): JSX.Element {
  return <span className={`category-badge ${category}`}>{CATEGORY_LABELS[category]}</span>;
}

function StatusDot({ risk }: { risk: ProcessInfo['riskLevel'] }): JSX.Element {
  return <span className={`status-dot ${risk}`} />;
}

function Usage({ value, max, suffix }: { value: number; max: number; suffix: string }): JSX.Element {
  const width = Math.min(100, Math.max(2, (value / max) * 100));
  return (
    <div className="usage">
      <span>
        {value}
        {suffix}
      </span>
      <div>
        <i style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }): JSX.Element {
  return <div className="empty">{label}</div>;
}

function buildNavigation(snapshot: ProcessSnapshot | null): Array<{ id: ViewId; label: string; count: number | string; icon: typeof Activity }> {
  return [
    { id: 'dashboard', label: 'Dashboard', count: '', icon: Monitor },
    { id: 'processes', label: 'Processes', count: snapshot?.summary.totalProcesses ?? 0, icon: Activity },
    { id: 'services', label: 'Services', count: snapshot?.summary.listeningPorts ?? 0, icon: Server },
    { id: 'agents', label: 'Agents', count: snapshot?.summary.aiAgents ?? 0, icon: Bot },
    { id: 'cleanup', label: 'Cleanup', count: snapshot?.summary.cleanCandidates ?? 0, icon: ListChecks },
    { id: 'network', label: 'Network', count: snapshot?.summary.internetProcesses ?? 0, icon: Network },
    { id: 'settings', label: 'Settings', count: '', icon: Settings }
  ];
}

function buildProcessBuckets(processes: ProcessInfo[]): {
  cleanCandidates: ProcessInfo[];
  localServices: ProcessInfo[];
  agents: ProcessInfo[];
  networkProcesses: ProcessInfo[];
  highLoad: ProcessInfo[];
  processByPid: Map<number, ProcessInfo>;
  searchIndex: Map<number, string>;
} {
  const cleanCandidates: ProcessInfo[] = [];
  const localServices: ProcessInfo[] = [];
  const agents: ProcessInfo[] = [];
  const networkProcesses: ProcessInfo[] = [];
  const processByPid = new Map<number, ProcessInfo>();
  const searchIndex = new Map<number, string>();

  for (const process of processes) {
    processByPid.set(process.pid, process);
    searchIndex.set(process.pid, buildProcessSearchText(process));

    if (process.cleanCandidate) {
      cleanCandidates.push(process);
    }

    if (process.ports.length) {
      localServices.push(process);
    }

    if (process.category === 'ai-agent') {
      agents.push(process);
    }

    if (process.networkConnections.length) {
      networkProcesses.push(process);
    }
  }

  const highLoad = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 6);

  return { cleanCandidates, localServices, agents, networkProcesses, highLoad, processByPid, searchIndex };
}

function buildProcessSearchText(process: ProcessInfo): string {
  return [
    process.name,
    process.command,
    process.description,
    process.confidence,
    process.evidence.join(' '),
    process.provenance.executablePath,
    process.provenance.parentName ?? '',
    process.provenance.launchMethod,
    process.provenance.projectPath ?? '',
    process.serviceGroup.label,
    process.serviceGroup.detail,
    process.networkConnections.map((connection) => `${connection.service} ${connection.remoteScope} ${connection.direction}`).join(' '),
    process.user,
    String(process.pid),
    portsText(process),
    connectionsText(process),
    formatBps(process.network.downloadBps, process.network.status),
    formatBps(process.network.uploadBps, process.network.status)
  ]
    .join(' ')
    .toLowerCase();
}

function applyUserRules(processes: ProcessInfo[], rules: UserRules): ProcessInfo[] {
  return processes.map((process) => {
    const state = ruleStateForProcess(process, rules);
    const presetRisk = riskForPreset(process, rules.preset);

    if (state === 'keep') {
      return {
        ...process,
        cleanCandidate: false,
        riskLevel: process.riskLevel === 'high' ? 'medium' : 'low',
        evidence: [...process.evidence, 'User rule: always keep']
      };
    }

    if (state === 'flag') {
      return {
        ...process,
        riskLevel: 'high',
        evidence: [...process.evidence, 'User rule: always flag']
      };
    }

    if (presetRisk) {
      return {
        ...process,
        riskLevel: presetRisk,
        evidence: [...process.evidence, `Profile rule: ${rules.preset}`]
      };
    }

    return process;
  });
}

function riskForPreset(process: ProcessInfo, preset: UserRulePreset): ProcessInfo['riskLevel'] | null {
  if (preset === 'strict' && process.category === 'unknown' && (process.ports.length || process.networkConnections.length)) {
    return 'high';
  }

  if (preset === 'focus' && (process.cleanCandidate || process.cpuPercent >= 15 || networkTrafficBps(process) >= HIGH_TRAFFIC_BPS)) {
    return process.riskLevel === 'high' ? 'high' : 'medium';
  }

  if (preset === 'deep-dev' && (process.category === 'local-server' || process.category === 'database' || process.category === 'ai-agent')) {
    return 'low';
  }

  return null;
}

function ruleStateForProcess(process: ProcessInfo, rules: UserRules): 'keep' | 'flag' | 'none' {
  const signature = processRuleSignature(process);
  if (rules.keep.includes(signature)) {
    return 'keep';
  }
  if (rules.flag.includes(signature)) {
    return 'flag';
  }
  return 'none';
}

function processRuleSignature(process: ProcessInfo): string {
  return [process.name, process.provenance.executableName, process.category, process.serviceGroup.label].join('|').toLowerCase();
}

function getBaseProcessesForView(view: ViewId, processes: ProcessInfo[]): ProcessInfo[] {
  if (view === 'services') {
    return processes.filter((process) => process.ports.length > 0);
  }

  if (view === 'agents') {
    return processes.filter((process) => process.category === 'ai-agent');
  }

  if (view === 'cleanup') {
    return processes.filter((process) => process.cleanCandidate);
  }

  if (view === 'network') {
    return processes.filter((process) => process.networkConnections.length > 0);
  }

  return processes;
}

function pickFocusProcess(processes: ProcessInfo[]): ProcessInfo | null {
  return [...processes].sort((a, b) => processPriority(b) - processPriority(a))[0] ?? null;
}

function buildReviewQueue(
  processes: ProcessInfo[],
  highLoad: ProcessInfo[],
  localServices: ProcessInfo[],
  cleanCandidates: ProcessInfo[],
  networkProcesses: ProcessInfo[]
): ProcessInfo[] {
  const reviewMap = new Map<number, ProcessInfo>();
  const add = (process: ProcessInfo): void => {
    if (processPriority(process) > 20 || process.cleanCandidate || process.networkConnections.length || process.ports.length) {
      reviewMap.set(process.pid, process);
    }
  };

  processes.filter((process) => process.category === 'unknown').forEach(add);
  networkProcesses.forEach(add);
  localServices.forEach(add);
  cleanCandidates.forEach(add);
  highLoad.forEach(add);

  return [...reviewMap.values()].sort((a, b) => processPriority(b) - processPriority(a));
}

function processPriority(process: ProcessInfo): number {
  const unknownInternet = process.category === 'unknown' && process.networkConnections.length > 0 ? 100 : 0;
  const unknownListener = process.category === 'unknown' && process.ports.length > 0 ? 70 : 0;
  const risk = process.riskLevel === 'high' ? 60 : process.riskLevel === 'medium' ? 35 : 0;
  return unknownInternet + unknownListener + risk + process.impactScore + process.cpuPercent;
}

function countActiveFilters(filters: ProcessFilters): number {
  return Number(filters.category !== 'all') + Number(filters.risk !== 'all') + Number(filters.activity !== 'all');
}

function matchesProcessFilters(process: ProcessInfo, filters: ProcessFilters): boolean {
  if (filters.category !== 'all' && process.category !== filters.category) {
    return false;
  }

  if (filters.risk === 'review' && process.riskLevel !== 'medium' && process.riskLevel !== 'high') {
    return false;
  }

  if (filters.risk === 'high' && process.riskLevel !== 'high') {
    return false;
  }

  if (filters.activity === 'internet' && !process.networkConnections.length) {
    return false;
  }

  if (filters.activity === 'listening' && !process.ports.length) {
    return false;
  }

  if (filters.activity === 'cleanup' && !process.cleanCandidate) {
    return false;
  }

  if (filters.activity === 'high-traffic' && networkTrafficBps(process) < HIGH_TRAFFIC_BPS) {
    return false;
  }

  if (filters.activity === 'non-local' && !hasNonLocalActivity(process)) {
    return false;
  }

  return true;
}

function compareProcesses(a: ProcessInfo, b: ProcessInfo, key: SortKey, direction: 'asc' | 'desc'): number {
  const modifier = direction === 'asc' ? 1 : -1;

  if (key === 'name' || key === 'category') {
    return a[key].localeCompare(b[key]) * modifier;
  }

  if (key === 'ports') {
    return (a.ports.length - b.ports.length) * modifier;
  }

  if (key === 'connections') {
    return (a.networkConnections.length - b.networkConnections.length) * modifier;
  }

  if (key === 'networkDownloadBps') {
    return ((a.network.downloadBps ?? -1) - (b.network.downloadBps ?? -1)) * modifier;
  }

  if (key === 'networkUploadBps') {
    return ((a.network.uploadBps ?? -1) - (b.network.uploadBps ?? -1)) * modifier;
  }

  return (a[key] - b[key]) * modifier;
}

function portsText(process: ProcessInfo): string {
  if (!process.ports.length) {
    return '';
  }

  const ports = process.ports.map((port) => port.port);
  return ports.length > 2 ? `${ports.slice(0, 2).join(', ')} +${ports.length - 2}` : ports.join(', ');
}

function connectionsText(process: ProcessInfo): string {
  if (!process.networkConnections.length) {
    return '';
  }

  const count = process.networkConnections.length;
  return `${count} internet connection${count === 1 ? '' : 's'}`;
}

function networkTrafficBps(process: ProcessInfo): number {
  return (process.network.downloadBps ?? 0) + (process.network.uploadBps ?? 0);
}

function hasNonLocalActivity(process: ProcessInfo): boolean {
  return (
    process.networkConnections.some((connection) => connection.remoteScope === 'public-internet' || connection.remoteScope === 'unknown') ||
    process.ports.some((port) => port.address === '*' || port.address === '0.0.0.0' || port.address === '::')
  );
}

function networkServicesText(process: ProcessInfo): string {
  if (!process.networkConnections.length) {
    return '';
  }

  const services = [...new Set(process.networkConnections.map((connection) => connection.service))];
  return services.length > 2 ? `${services.slice(0, 2).join(', ')} +${services.length - 2}` : services.join(', ');
}

function remoteDestinationsText(process: ProcessInfo): string {
  if (!process.networkConnections.length) {
    return '';
  }

  const destinations = [...new Set(process.networkConnections.map(remoteConnectionLabel))];
  return destinations.length > 2 ? `${destinations.slice(0, 2).join(', ')} +${destinations.length - 2}` : destinations.join(', ');
}

function remoteConnectionLabel(connection: ProcessInfo['networkConnections'][number]): string {
  return `${connection.service} · ${connection.remoteAddress}:${connection.remotePort}`;
}

function localUrlText(process: ProcessInfo): string {
  const firstPort = process.ports[0];
  if (!firstPort) {
    return '';
  }

  const host = firstPort.address === '*' || firstPort.address === '0.0.0.0' ? 'localhost' : firstPort.address === '::1' ? '[::1]' : firstPort.address;
  return `${host}:${firstPort.port}`;
}

function bindScopeText(process: ProcessInfo): string {
  if (!process.ports.length) {
    return 'No local ports';
  }

  if (process.ports.some((port) => port.address === '*' || port.address === '0.0.0.0')) {
    return 'Network-visible listener';
  }

  return 'Local-only listener';
}

function localServiceSummary(process: ProcessInfo): string {
  const localUrl = localUrlText(process);
  const scope = bindScopeText(process);
  return localUrl ? `${localUrl} · ${scope} · ${process.serviceGroup.label}` : `${scope} · ${process.serviceGroup.label}`;
}

function updateStoredTrendEntries(processes: ProcessInfo[], sampledAtMs: number): Map<string, ProcessTrendSummary> {
  const now = Number.isFinite(sampledAtMs) ? sampledAtMs : Date.now();
  const cutoff = now - TREND_RETENTION_MS;
  const entries = new Map(readTrendEntries().map((entry) => [entry.key, entry]));

  for (const process of processes) {
    const key = processTrendKey(process);
    const entry = entries.get(key) ?? {
      key,
      name: process.name,
      category: process.category,
      samples: []
    };
    const lastSample = entry.samples.at(-1);

    entry.name = process.name;
    entry.category = process.category;
    entry.samples = entry.samples.filter((sample) => sample.t >= cutoff);

    if (!lastSample || now - lastSample.t >= TREND_SAMPLE_INTERVAL_MS) {
      entry.samples.push({
        t: now,
        cpu: process.cpuPercent,
        mem: Math.round(process.rssKb / 1024),
        down: process.network.downloadBps ?? 0,
        up: process.network.uploadBps ?? 0
      });
    }

    entry.samples = entry.samples.slice(-288);
    entries.set(key, entry);
  }

  const nextEntries = [...entries.values()].filter((entry) => entry.samples.some((sample) => sample.t >= cutoff));
  writeStoredJson(TREND_STORAGE_KEY, nextEntries);
  return summarizeTrendEntries(nextEntries);
}

function summarizeTrendEntries(entries: TrendEntry[]): Map<string, ProcessTrendSummary> {
  const summaries = new Map<string, ProcessTrendSummary>();

  for (const entry of entries) {
    if (!entry.samples.length) {
      continue;
    }

    const cpuTotal = entry.samples.reduce((total, sample) => total + sample.cpu, 0);
    const memoryTotal = entry.samples.reduce((total, sample) => total + sample.mem, 0);
    summaries.set(entry.key, {
      samples: entry.samples.length,
      avgCpu: round(cpuTotal / entry.samples.length),
      peakCpu: round(Math.max(...entry.samples.map((sample) => sample.cpu))),
      avgMemoryMb: Math.round(memoryTotal / entry.samples.length),
      peakTrafficBps: Math.max(...entry.samples.map((sample) => sample.down + sample.up)),
      firstSeen: Math.min(...entry.samples.map((sample) => sample.t)),
      lastSeen: Math.max(...entry.samples.map((sample) => sample.t))
    });
  }

  return summaries;
}

function processTrendKey(process: ProcessInfo): string {
  return [process.name, process.provenance.executableName, process.user, process.serviceGroup.label].join('|').toLowerCase();
}

function cleanupReason(process: ProcessInfo): string {
  if (process.category === 'local-server' && process.ports.length) {
    return `Development service with ${portsText(process)} open`;
  }

  if (process.category === 'ai-agent') {
    return `Agent helper owned by ${process.user}`;
  }

  if (process.networkConnections.length) {
    return `${connectionsText(process)} active`;
  }

  return process.safeToTerminate ? 'User-owned process with guarded stop available' : 'Protected process';
}

function reviewReason(process: ProcessInfo): string {
  if (process.category === 'unknown' && process.networkConnections.length) {
    return `Unknown process contacting ${remoteDestinationsText(process)}`;
  }

  if (process.category === 'unknown' && process.ports.length) {
    return `Unknown listener on ${portsText(process)}`;
  }

  if (process.cleanCandidate) {
    return cleanupReason(process);
  }

  if (process.networkConnections.length) {
    return connectionsText(process);
  }

  if (process.ports.length) {
    return `${bindScopeText(process)} on ${portsText(process)}`;
  }

  if (process.cpuPercent >= 10) {
    return `${process.cpuPercent}% CPU`;
  }

  return process.description;
}

function confidenceLabel(process: ProcessInfo): string {
  return process.confidence[0].toUpperCase() + process.confidence.slice(1);
}

function getSystemStatus(snapshot: ProcessSnapshot | null, processes: ProcessInfo[]): { tone: 'good' | 'warning' | 'critical'; label: string; description: string; badge: string } {
  if (!snapshot) {
    return { tone: 'warning', label: 'Collecting local state', description: 'MetalExplorer is reading process and network data.', badge: 'Scanning' };
  }

  const unknownInternet = processes.filter((process) => process.category === 'unknown' && process.networkConnections.length > 0).length;
  const highLoad = snapshot.summary.highCpu;
  const cleanupCpu = snapshot.summary.cleanableCpuPercent;

  if (unknownInternet >= 2 || cleanupCpu >= 45) {
    return {
      tone: 'critical',
      label: 'Needs review',
      description: 'Multiple unknown internet processes or high cleanup pressure are active.',
      badge: 'Critical'
    };
  }

  if (unknownInternet > 0 || snapshot.summary.unknownNetworkListeners > 0 || highLoad > 0 || cleanupCpu >= 12) {
    return {
      tone: 'warning',
      label: 'Review needed',
      description: 'A process, listener, or cleanup candidate is worth checking before it keeps running.',
      badge: 'Review'
    };
  }

  return {
    tone: 'good',
    label: 'Looks clear',
    description: 'No unusual listeners, unknown internet processes, or heavy cleanup candidates stand out.',
    badge: 'Good'
  };
}

function sanitizeAiText(value: string): string {
  const trimmed = value.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Partial<AiExplanation>;
      if (typeof parsed.summary === 'string') {
        return parsed.summary.trim();
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function formatBps(value: number | null, status: ProcessInfo['network']['status']): string {
  if (value === null) {
    return status === 'measuring' ? 'Measuring' : 'Unavailable';
  }

  return `${formatBytes(value)}/s`;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }

  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function formatSampleTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return 'Just now';
  }

  return time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function getSampleStatus(snapshot: ProcessSnapshot | null, refreshMs: number): { label: string; tone: 'live' | 'stale' | 'scanning' } {
  if (!snapshot) {
    return { label: 'Scanning', tone: 'scanning' };
  }

  const generatedAt = new Date(snapshot.generatedAt).getTime();
  if (Number.isNaN(generatedAt)) {
    return { label: 'Sample unknown', tone: 'stale' };
  }

  const ageMs = Date.now() - generatedAt;
  if (ageMs > refreshMs * 3) {
    return { label: `Stale ${formatDuration(Math.round(ageMs / 1000))}`, tone: 'stale' };
  }

  return { label: 'Live sample', tone: 'live' };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function readStoredNumber(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function writeStoredNumber(key: string, value: number): void {
  window.localStorage.setItem(key, String(value));
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key);
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function writeStoredBoolean(key: string, value: boolean): void {
  window.localStorage.setItem(key, String(value));
}

function readUserRules(): UserRules {
  const parsed = readStoredJson<UserRules>(RULE_STORAGE_KEY, DEFAULT_RULES);
  return {
    preset: parsed.preset === 'focus' || parsed.preset === 'deep-dev' || parsed.preset === 'strict' ? parsed.preset : 'balanced',
    keep: Array.isArray(parsed.keep) ? parsed.keep.filter((value) => typeof value === 'string') : [],
    flag: Array.isArray(parsed.flag) ? parsed.flag.filter((value) => typeof value === 'string') : []
  };
}

function readTrendEntries(): TrendEntry[] {
  const parsed = readStoredJson<TrendEntry[]>(TREND_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((entry) => typeof entry.key === 'string' && Array.isArray(entry.samples))
    .map((entry) => ({
      key: entry.key,
      name: typeof entry.name === 'string' ? entry.name : 'unknown',
      category: CATEGORY_LABELS[entry.category] ? entry.category : 'unknown',
      samples: entry.samples.filter(
        (sample) =>
          Number.isFinite(sample.t) &&
          Number.isFinite(sample.cpu) &&
          Number.isFinite(sample.mem) &&
          Number.isFinite(sample.down) &&
          Number.isFinite(sample.up)
      )
    }));
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}
