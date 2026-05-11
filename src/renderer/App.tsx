import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  Cpu,
  ExternalLink,
  HardDrive,
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
import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { AiExplanation, AppSettings, ProcessCategory, ProcessInfo, ProcessSnapshot, ThemeName } from '../shared/types';

type ViewId = 'dashboard' | 'processes' | 'services' | 'agents' | 'cleanup' | 'network' | 'settings';
type CategoryFilter = 'all' | 'local-server' | 'ai-agent' | 'developer-tool' | 'unknown';
type RiskFilter = 'all' | 'review' | 'high';
type ActivityFilter = 'all' | 'internet' | 'listening' | 'cleanup';
type ProcessFilters = {
  category: CategoryFilter;
  risk: RiskFilter;
  activity: ActivityFilter;
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
  unknown: 'Unknown'
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
  const [cleanupSelection, setCleanupSelection] = useState<Set<number>>(new Set());
  const [connectivityHistory, setConnectivityHistory] = useState<number[]>(Array.from({ length: 72 }, () => 0));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredBoolean('metalexplorer.sidebarCollapsed', false));
  const [filtersVisible, setFiltersVisible] = useState(() => readStoredBoolean('metalexplorer.filtersVisible', false));
  const [filters, setFilters] = useState<ProcessFilters>(DEFAULT_FILTERS);
  const [sidebarWidth, setSidebarWidth] = useState(() => clamp(readStoredNumber('metalexplorer.sidebarWidth', 232), 190, 320));
  const [inspectorWidth, setInspectorWidth] = useState(() => clamp(readStoredNumber('metalexplorer.inspectorWidth', 356), 300, 620));

  const refresh = useCallback(async () => {
    try {
      const nextSnapshot = await window.metalExplorer.listProcesses();
      setSnapshot(nextSnapshot);
      setSelectedPid((currentPid) => {
        if (currentPid && nextSnapshot.processes.some((process) => process.pid === currentPid)) {
          return currentPid;
        }

        return pickFocusProcess(nextSnapshot.processes)?.pid ?? nextSnapshot.processes[0]?.pid ?? null;
      });
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to read process state.');
    } finally {
      setLoading(false);
    }
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

  const processes = snapshot?.processes ?? [];
  const cleanCandidates = processes.filter((process) => process.cleanCandidate);
  const localServices = processes.filter((process) => process.ports.length > 0);
  const agents = processes.filter((process) => process.category === 'ai-agent');
  const networkProcesses = processes.filter((process) => process.networkConnections.length > 0);
  const highLoad = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 6);
  const selectedProcess = processes.find((process) => process.pid === selectedPid) ?? pickFocusProcess(processes);
  const tableView = view !== 'dashboard' && view !== 'settings';
  const activeFilterCount = countActiveFilters(filters);

  const filteredProcesses = useMemo(() => {
    const base = getBaseProcessesForView(view, processes);
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = base.filter((process) => {
      if (!matchesProcessFilters(process, filters)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        process.name,
        process.command,
        process.description,
        process.user,
        String(process.pid),
        portsText(process),
        connectionsText(process),
        formatBps(process.network.downloadBps, process.network.status),
        formatBps(process.network.uploadBps, process.network.status)
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });

    return filtered.sort((a, b) => compareProcesses(a, b, sortKey, sortDirection));
  }, [filters, processes, query, sortDirection, sortKey, view]);

  function changeView(nextView: ViewId): void {
    setView(nextView);
    setQuery('');
    setAiExplanation(null);

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

  async function terminateSelected(): Promise<void> {
    if (!selectedProcess?.safeToTerminate) {
      return;
    }

    if (confirmPid !== selectedProcess.pid) {
      setConfirmPid(selectedProcess.pid);
      window.setTimeout(() => setConfirmPid((pid) => (pid === selectedProcess.pid ? null : pid)), 4000);
      return;
    }

    const result = await window.metalExplorer.terminateProcess(selectedProcess.pid);
    setNotice(result.message);
    setConfirmPid(null);
    await refresh();
  }

  async function terminateCleanupSelection(): Promise<void> {
    const pids = [...cleanupSelection];
    if (!pids.length) {
      setCleanupSelection(new Set(cleanCandidates.map((process) => process.pid)));
      return;
    }

    const results = await Promise.all(pids.map((pid) => window.metalExplorer.terminateProcess(pid)));
    const stopped = results.filter((result) => result.ok).length;
    setNotice(`Stopped ${stopped} of ${pids.length} selected cleanup candidates.`);
    setCleanupSelection(new Set());
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
            onSelect={(pid) => {
              setSelectedPid(pid);
              setView('processes');
            }}
            onNavigate={changeView}
          />
        ) : null}

        {view === 'settings' ? <SettingsPanel settings={settings} onSaved={setSettings} /> : null}

        {view !== 'dashboard' && view !== 'settings' ? (
          <ProcessTable
            view={view}
            processes={filteredProcesses}
            selectedPid={selectedProcess?.pid ?? null}
            sortKey={sortKey}
            sortDirection={sortDirection}
            cleanupSelection={cleanupSelection}
            confirmPid={confirmPid}
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
                return next;
              });
            }}
            onTerminateSelection={() => void terminateCleanupSelection()}
            onKillSelectedNetwork={() => void terminateSelected()}
            onOpenService={(process) => void openSelectedService(process)}
          />
        ) : null}
      </main>

      <div className="resize-handle inspector-resizer" onMouseDown={(event) => beginResize('inspector', event)} />

      <aside className="inspector">
        {view === 'settings' ? (
          <PrivacyPanel settings={settings} />
        ) : (
          <Inspector
            process={selectedProcess}
            aiExplanation={aiExplanation}
            aiLoading={aiLoading}
            confirmPid={confirmPid}
            onExplain={() => void explainSelected()}
            onTerminate={() => void terminateSelected()}
            onOpenService={(process) => void openSelectedService(process)}
          />
        )}
      </aside>
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
  onSelect: (pid: number) => void;
  onNavigate: (view: ViewId) => void;
}): JSX.Element {
  const status = getSystemStatus(snapshot, processes);

  return (
    <div className="dashboard scroll-area">
      <section className={`status-panel ${status.tone}`}>
        <div>
          <span className="section-kicker">General Status</span>
          <h2>{status.label}</h2>
          <p>{status.description}</p>
        </div>
        <StatusBadge tone={status.tone} label={status.badge} />
      </section>

      <section className="metric-grid">
        <MetricButton
          label="Processes"
          value={snapshot?.summary.totalProcesses ?? 0}
          detail={`${snapshot?.summary.userProcesses ?? 0} yours`}
          icon={Monitor}
          onClick={() => onNavigate('processes')}
        />
        <MetricButton
          label="Local services"
          value={snapshot?.summary.localServers ?? 0}
          detail={`${snapshot?.summary.listeningPorts ?? 0} ports`}
          icon={Server}
          onClick={() => onNavigate('services')}
        />
        <MetricButton
          label="Agents"
          value={snapshot?.summary.aiAgents ?? 0}
          detail={`${snapshot?.summary.cleanCandidates ?? 0} cleanup`}
          icon={Bot}
          onClick={() => onNavigate('agents')}
        />
        <MetricButton
          label="Internet"
          value={snapshot?.summary.internetProcesses ?? 0}
          detail={`${snapshot?.summary.externalConnections ?? 0} connections`}
          icon={Network}
          onClick={() => onNavigate('network')}
        />
      </section>

      <section className="connectivity-card">
        <div className="panel-heading">
          <h3>Connectivity History</h3>
          <span>{formatBps(snapshot?.summary.networkDownloadBps ?? null, snapshot ? 'available' : 'measuring')} down</span>
        </div>
        <ConnectivityHistory values={connectivityHistory} />
      </section>

      <section className="overview-grid">
        <ListPanel title="High Load" rows={highLoad} value={(process) => `${process.cpuPercent}%`} onSelect={onSelect} />
        <ListPanel title="Internet Processes" rows={networkProcesses.slice(0, 6)} value={connectionsText} onSelect={onSelect} />
        <div className="panel">
          <div className="panel-heading">
            <h3>Cleanup</h3>
            <button type="button" onClick={() => onNavigate('cleanup')}>
              Open
            </button>
          </div>
          {cleanCandidates.length ? (
            cleanCandidates.slice(0, 6).map((process) => (
              <button className="list-row" type="button" key={process.pid} onClick={() => onSelect(process.pid)}>
                <StatusDot risk={process.riskLevel} />
                <span>{process.name}</span>
                <strong>{process.category === 'local-server' ? portsText(process) : `${process.cpuPercent}%`}</strong>
              </button>
            ))
          ) : (
            <Empty label="No cleanup candidates" />
          )}
        </div>
      </section>

      <section className="overview-grid compact">
        <ListPanel title="Listening Services" rows={localServices.slice(0, 6)} value={portsText} onSelect={onSelect} />
        <StatusPanel title="Cleanable memory" value={`${snapshot?.summary.cleanableMemoryMb ?? 0} MB`} detail={`${snapshot?.summary.cleanableCpuPercent ?? 0}% CPU`} />
        <StatusPanel title="Unknown network" value={snapshot?.summary.unknownNetworkListeners ?? 0} detail="local listeners" />
      </section>
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
          ['cleanup', 'Cleanup']
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
  confirmPid,
  onSort,
  onSelect,
  onToggleCleanup,
  onTerminateSelection,
  onKillSelectedNetwork,
  onOpenService
}: {
  view: ViewId;
  processes: ProcessInfo[];
  selectedPid: number | null;
  sortKey: SortKey;
  sortDirection: 'asc' | 'desc';
  cleanupSelection: Set<number>;
  confirmPid: number | null;
  onSort: (key: SortKey) => void;
  onSelect: (pid: number) => void;
  onToggleCleanup: (pid: number) => void;
  onTerminateSelection: () => void;
  onKillSelectedNetwork: () => void;
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
                ? `${cleanupSelection.size} selected`
                : `${processes.length} candidates`
              : `${processes.length} internet-connected processes`}
          </span>
          {isCleanup ? (
            <button type="button" onClick={onTerminateSelection}>
              {cleanupSelection.size ? 'Terminate selected' : 'Select all'}
            </button>
          ) : (
            <button className="danger-button actionbar-danger" type="button" onClick={onKillSelectedNetwork} disabled={!selectedProcess?.safeToTerminate}>
              {confirmPid === selectedPid ? 'Confirm kill' : 'Kill selected'}
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
                        {process.user} · PID {process.pid}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <CategoryBadge category={process.category} />
                </td>
                {isNetwork ? (
                  <td className="network-remote">{networkServicesText(process)}</td>
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
  confirmPid,
  onExplain,
  onTerminate,
  onOpenService
}: {
  process: ProcessInfo | null;
  aiExplanation: AiExplanation | null;
  aiLoading: boolean;
  confirmPid: number | null;
  onExplain: () => void;
  onTerminate: () => void;
  onOpenService: (process: ProcessInfo) => void;
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
          <p>PID {process.pid}</p>
        </div>
      </div>

      <div className="safety-card">
        <span>{process.safeToTerminate ? 'Guarded termination available' : 'Protected from termination'}</span>
        <strong>{process.cleanCandidate ? 'Cleanup candidate' : CATEGORY_LABELS[process.category]}</strong>
      </div>

      <div className="button-row">
        <button className="primary-button" type="button" onClick={onExplain} disabled={aiLoading}>
          <Sparkles size={15} />
          {aiLoading ? 'Explaining' : 'AI Explain'}
        </button>
        <button className="danger-button" type="button" onClick={onTerminate} disabled={!process.safeToTerminate}>
          {confirmPid === process.pid ? <CircleStop size={15} /> : <Power size={15} />}
          {confirmPid === process.pid ? 'Confirm' : 'Terminate'}
        </button>
      </div>

      {process.ports.length ? (
        <button className="open-service-button" type="button" onClick={() => onOpenService(process)}>
          <ExternalLink size={15} />
          Open localhost:{process.ports[0].port}
        </button>
      ) : null}

      <div className="stat-grid">
        <Stat label="CPU" value={`${process.cpuPercent}%`} icon={Cpu} />
        <Stat label="Memory" value={`${Math.round(process.rssKb / 1024)} MB`} icon={HardDrive} />
        <Stat label="Down" value={formatBps(process.network.downloadBps, process.network.status)} icon={Network} />
        <Stat label="Up" value={formatBps(process.network.uploadBps, process.network.status)} icon={Activity} />
        <Stat label="Impact" value={`${process.impactScore}/100`} icon={Activity} />
        <Stat label="Uptime" value={formatDuration(process.uptimeSeconds)} icon={Shield} />
      </div>

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

      <InspectorSection title="Network">
        {process.networkConnections.length ? (
          <>
            <p>{process.networkConnections.length} active internet connection{process.networkConnections.length === 1 ? '' : 's'}.</p>
            <div className="chip-row">
              {process.networkConnections.slice(0, 8).map((connection) => (
                <span className="chip" key={`${connection.localPort}-${connection.remoteAddress}-${connection.remotePort}`}>
                  {networkServiceLabel(connection.remotePort)}
                </span>
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

      <InspectorSection title="Command">
        <code>{process.command}</code>
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

function InspectorSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function SettingsPanel({ settings, onSaved }: { settings: AppSettings | null; onSaved: (settings: AppSettings) => void }): JSX.Element {
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
      <section className="form-card">
        <h2>Theme</h2>
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
      </section>

      <section className="form-card">
        <h2>AI Provider</h2>
        <label>
          <span>Base URL</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label>
          <span>Model</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label>
          <span>API Key</span>
          <input value={apiKey} type="password" placeholder={settings?.hasApiKey ? 'Saved locally' : 'sk-...'} onChange={(event) => setApiKey(event.target.value)} />
        </label>
      </section>

      <section className="form-card">
        <h2>Local App</h2>
        <label>
          <span>Refresh interval</span>
          <input value={refreshMs} type="number" min={1000} max={30000} step={500} onChange={(event) => setRefreshMs(Number(event.target.value))} />
        </label>
        <label className="toggle-row">
          <input checked={rememberApiKey} type="checkbox" onChange={(event) => setRememberApiKey(event.target.checked)} />
          <span>Remember API key locally</span>
        </label>
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

function networkServicesText(process: ProcessInfo): string {
  if (!process.networkConnections.length) {
    return '';
  }

  const services = [...new Set(process.networkConnections.map((connection) => networkServiceLabel(connection.remotePort)))];
  return services.length > 2 ? `${services.slice(0, 2).join(', ')} +${services.length - 2}` : services.join(', ');
}

function networkServiceLabel(port: number): string {
  if (port === 443) {
    return 'HTTPS';
  }

  if (port === 80) {
    return 'HTTP';
  }

  if (port === 53) {
    return 'DNS';
  }

  if (port === 22) {
    return 'SSH';
  }

  return `TCP ${port}`;
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
      label: 'Worth looking at',
      description: 'There is at least one process, listener, or cleanup candidate worth reviewing.',
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
