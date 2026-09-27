import { Check, ChevronRight, ExternalLink, Globe, ListChecks, Search, Server, Sparkles } from 'lucide-react';
import type { JSX, MouseEvent } from 'react';
import type { AgentSession, ListeningPort, ProcessInfo } from '../../shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { AgentMonogram, Button, EmptyState, Pill, ProcessGlyph, StatusDot, type Tone } from '../components/ui';
import { formatCpuTime, formatDuration, formatKb, formatPercent, formatRate, pluralize } from '../lib/format';
import {
  CATEGORY_LABELS,
  cleanupReason,
  localUrl,
  networkLabel,
  portsText,
  remoteSummary,
  type SortKey,
  type SortState,
  type TreeRow
} from '../lib/model';

const RISK_TONES: Record<ProcessInfo['riskLevel'], Tone> = { low: 'good', medium: 'warning', high: 'critical', unknown: 'neutral' };

function NameCell({ process, detail }: { process: ProcessInfo; detail?: string }): JSX.Element {
  return (
    <div className="name-cell">
      <ProcessGlyph process={process} />
      <span className="name-text">{process.name}</span>
      {detail ? <span className="name-detail">{detail}</span> : null}
    </div>
  );
}

function processDetail(process: ProcessInfo): string | undefined {
  if (process.provenance.appBundle && process.provenance.appBundle !== process.name) return process.provenance.appBundle;
  if (process.provenance.projectPath) return process.serviceGroup.label;
  return undefined;
}

function kindLabel(process: ProcessInfo): string {
  if (process.tags.includes('coding-agent')) return 'Agent';
  if (process.tags.includes('shell')) return 'Shell';
  if (process.tags.includes('terminal')) return 'Terminal';
  if (process.tags.includes('mcp')) return 'MCP server';
  return CATEGORY_LABELS[process.category];
}

function KindCell({ process }: { process: ProcessInfo }): JSX.Element {
  return (
    <span className="kind-cell" title={`${process.confidence} confidence · ${process.riskLevel} risk`}>
      <StatusDot tone={RISK_TONES[process.riskLevel]} />
      {kindLabel(process)}
    </span>
  );
}

const cpuColumn: Column<ProcessInfo> = {
  id: 'cpu',
  title: '% CPU',
  width: '76px',
  align: 'right',
  sortKey: 'cpuPercent',
  render: (process) => <span className={`mono ${process.cpuPercent >= 80 ? 'tone-text-warning' : ''}`}>{process.cpuPercent.toFixed(1)}</span>
};
const cpuTimeColumn: Column<ProcessInfo> = {
  id: 'cputime',
  title: 'CPU Time',
  width: '88px',
  align: 'right',
  sortKey: 'cpuTimeSeconds',
  render: (process) => <span className="mono muted">{formatCpuTime(process.cpuTimeSeconds)}</span>
};
const memoryColumn: Column<ProcessInfo> = {
  id: 'memory',
  title: 'Memory',
  width: '88px',
  align: 'right',
  sortKey: 'rssKb',
  render: (process) => <span className="mono">{formatKb(process.rssKb)}</span>
};
const pidColumn: Column<ProcessInfo> = {
  id: 'pid',
  title: 'PID',
  width: '68px',
  align: 'right',
  sortKey: 'pid',
  render: (process) => <span className="mono muted">{process.pid}</span>
};
const kindColumn: Column<ProcessInfo> = { id: 'kind', title: 'Kind', width: '96px', sortKey: 'category', render: (process) => <KindCell process={process} /> };
const ageColumn: Column<ProcessInfo> = {
  id: 'age',
  title: 'Age',
  width: '72px',
  align: 'right',
  sortKey: 'uptimeSeconds',
  render: (process) => <span className="mono muted">{formatDuration(process.uptimeSeconds)}</span>
};

interface ProcessTableProps {
  rows: TreeRow[];
  treeMode: boolean;
  collapsed: Set<number>;
  selectedPid: number | null;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (pid: number) => void;
  onToggle: (pid: number) => void;
}

export function ProcessesTable({ rows, treeMode, collapsed, selectedPid, sort, onSort, onSelect, onToggle }: ProcessTableProps): JSX.Element {
  const columns: Array<Column<TreeRow>> = [
    {
      id: 'name',
      title: 'Process Name',
      width: 'minmax(200px, 2.6fr)',
      sortKey: 'name',
      render: ({ process, depth, hasChildren, descendantCount }) => (
        <div className="name-cell" style={treeMode ? { paddingLeft: Math.min(depth, 12) * 14 } : undefined}>
          {treeMode ? (
            hasChildren ? (
              <button
                type="button"
                className={`disclosure ${collapsed.has(process.pid) ? '' : 'is-open'}`}
                aria-label={collapsed.has(process.pid) ? `Expand ${process.name}` : `Collapse ${process.name}`}
                onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                onClick={() => onToggle(process.pid)}
              >
                <ChevronRight size={12} strokeWidth={2.4} />
              </button>
            ) : (
              <span className="disclosure-spacer" />
            )
          ) : null}
          <ProcessGlyph process={process} />
          <span className="name-text">{process.name}</span>
          {treeMode && hasChildren && collapsed.has(process.pid) ? (
            <span className="name-detail">{descendantCount}</span>
          ) : !treeMode || depth < 3 ? (
            <span className="name-detail">{processDetail(process)}</span>
          ) : null}
        </div>
      )
    },
    ...[cpuColumn, cpuTimeColumn, memoryColumn].map(adapt),
    {
      id: 'ports',
      title: 'Ports',
      width: '72px',
      sortKey: 'ports',
      render: ({ process }) => <span className="mono muted">{portsText(process) || '-'}</span>
    },
    {
      id: 'network',
      title: 'Network',
      width: '84px',
      align: 'right',
      sortKey: 'network',
      render: ({ process }) => <span className="mono muted">{networkLabel(process)}</span>
    },
    adapt(pidColumn),
    { id: 'user', title: 'User', width: '90px', sortKey: 'user', render: ({ process }) => <span className="muted truncate">{process.user}</span> },
    adapt(kindColumn)
  ];

  return (
    <DataTable
      label="Processes"
      rows={rows}
      columns={columns}
      getKey={(row) => row.process.pid}
      selectedKey={selectedPid}
      onSelect={(key) => onSelect(Number(key))}
      onActivate={(row) => row.hasChildren && treeMode && onToggle(row.process.pid)}
      sort={sort}
      onSort={onSort}
      rowClassName={(row) => (row.process.category === 'macos-system' ? 'is-system' : '')}
      empty={<EmptyState icon={Search} title="No matching processes" detail="Try a different search or filter." />}
    />
  );
}

function adapt(column: Column<ProcessInfo>): Column<TreeRow> {
  return { ...column, render: (row) => column.render(row.process) };
}

export interface ServiceRow {
  key: string;
  process: ProcessInfo;
  port: ListeningPort;
}

export function buildServiceRows(processes: ProcessInfo[]): ServiceRow[] {
  return processes.flatMap((process) => process.ports.map((port) => ({ key: `${process.pid}:${port.port}`, process, port })));
}

export function ServicesTable({
  rows,
  selectedKey,
  agentsById,
  sort,
  onSort,
  onSelect,
  onOpen
}: {
  rows: ServiceRow[];
  selectedKey: string | null;
  agentsById: Map<string, AgentSession>;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (row: ServiceRow) => void;
  onOpen: (url: string) => void;
}): JSX.Element {
  const columns: Array<Column<ServiceRow>> = [
    { id: 'port', title: 'Port', width: '76px', sortKey: 'ports', render: ({ port }) => <strong className="mono">{port.port}</strong> },
    {
      id: 'exposure',
      title: 'Reachable from',
      width: '150px',
      render: ({ port }) =>
        port.address === '*' || port.address === '0.0.0.0' || port.address === '::' ? (
          <Pill tone="warning" title={`Bound to ${port.address}`}>
            <Globe size={11} /> Your network
          </Pill>
        ) : (
          <Pill tone="neutral" title={`Bound to ${port.address}`}>
            This Mac only
          </Pill>
        )
    },
    { id: 'name', title: 'Process', width: 'minmax(200px, 2fr)', sortKey: 'name', render: ({ process }) => <NameCell process={process} detail={processDetail(process)} /> },
    {
      id: 'owner',
      title: 'Started by',
      width: 'minmax(120px, 1.2fr)',
      render: ({ process }) => {
        const session = process.agentSessionId ? agentsById.get(process.agentSessionId) : null;
        return session ? (
          <span className="started-by">
            <AgentMonogram kind={session.kind} size={16} />
            {session.title ?? session.projectName}
          </span>
        ) : (
          <span className="muted truncate" title={process.provenance.launchMethod}>
            {process.provenance.parentName ?? '-'}
          </span>
        );
      }
    },
    { id: 'kind', title: 'Kind', width: '104px', sortKey: 'category', render: ({ process }) => <KindCell process={process} /> },
    { id: 'pid', title: 'PID', width: '68px', align: 'right', sortKey: 'pid', render: ({ process }) => <span className="mono muted">{process.pid}</span> },
    { id: 'age', title: 'Age', width: '72px', align: 'right', sortKey: 'uptimeSeconds', render: ({ process }) => <span className="mono muted">{formatDuration(process.uptimeSeconds)}</span> },
    {
      id: 'open',
      title: '',
      width: '40px',
      align: 'center',
      render: ({ process, port }) => {
        const url = localUrl(process, port);
        return url ? (
          <button type="button" className="row-action" aria-label={`Open ${url}`} title={`Open ${url}`} onMouseDown={(event) => event.stopPropagation()} onClick={() => onOpen(url)}>
            <ExternalLink size={13} />
          </button>
        ) : null;
      }
    }
  ];

  return (
    <DataTable
      label="Listening services"
      rows={rows}
      columns={columns}
      getKey={(row) => row.key}
      selectedKey={selectedKey}
      onSelect={(_key, row) => onSelect(row)}
      onActivate={(row) => {
        const url = localUrl(row.process, row.port);
        if (url) onOpen(url);
      }}
      sort={sort}
      onSort={onSort}
      empty={<EmptyState icon={Server} title="Nothing is listening" detail="No user-visible process has an open TCP port." />}
    />
  );
}

export function NetworkTable({
  rows,
  selectedPid,
  sort,
  onSort,
  onSelect
}: {
  rows: ProcessInfo[];
  selectedPid: number | null;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (pid: number) => void;
}): JSX.Element {
  const columns: Array<Column<ProcessInfo>> = [
    { id: 'name', title: 'Process', width: 'minmax(200px, 1.6fr)', sortKey: 'name', render: (process) => <NameCell process={process} detail={processDetail(process)} /> },
    {
      id: 'remote',
      title: 'Talking to',
      width: 'minmax(220px, 2fr)',
      render: (process) => <span className="mono muted truncate">{remoteSummary(process) || '-'}</span>
    },
    { id: 'conn', title: 'Conn.', width: '64px', align: 'right', sortKey: 'connections', render: (process) => <span className="mono">{process.networkConnections.length}</span> },
    {
      id: 'down',
      title: 'Download',
      width: '96px',
      align: 'right',
      sortKey: 'network',
      render: (process) => <span className="mono">{formatRate(process.network.downloadBps, process.network.status)}</span>
    },
    { id: 'up', title: 'Upload', width: '96px', align: 'right', render: (process) => <span className="mono">{formatRate(process.network.uploadBps, process.network.status)}</span> },
    pidColumn,
    kindColumn
  ];

  return (
    <DataTable
      label="Internet connections"
      rows={rows}
      columns={columns}
      getKey={(process) => process.pid}
      selectedKey={selectedPid}
      onSelect={(key) => onSelect(Number(key))}
      sort={sort}
      onSort={onSort}
      empty={<EmptyState icon={Globe} title="No internet connections" detail="No process has an established connection to a public address." />}
    />
  );
}

export function CleanupTable({
  rows,
  checked,
  selectedPid,
  sort,
  onSort,
  onSelect,
  onToggle,
  onToggleAll,
  onReview
}: {
  rows: ProcessInfo[];
  checked: Set<number>;
  selectedPid: number | null;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (pid: number) => void;
  onToggle: (pid: number) => void;
  onToggleAll: () => void;
  onReview: () => void;
}): JSX.Element {
  const selected = rows.filter((process) => checked.has(process.pid));
  const memoryKb = selected.reduce((total, process) => total + process.rssKb, 0);
  const cpu = selected.reduce((total, process) => total + process.cpuPercent, 0);
  const allChecked = rows.length > 0 && selected.length === rows.length;

  const columns: Array<Column<ProcessInfo>> = [
    {
      id: 'check',
      title: '',
      width: '36px',
      align: 'center',
      render: (process) => (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked.has(process.pid)}
          aria-label={`Select ${process.name}`}
          className={`checkbox ${checked.has(process.pid) ? 'is-checked' : ''}`}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onToggle(process.pid)}
        >
          {checked.has(process.pid) ? <Check size={11} strokeWidth={3} /> : null}
        </button>
      )
    },
    { id: 'name', title: 'Process', width: 'minmax(180px, 1.4fr)', sortKey: 'name', render: (process) => <NameCell process={process} /> },
    { id: 'reason', title: 'Why it can go', width: 'minmax(240px, 2.4fr)', render: (process) => <span className="truncate">{cleanupReason(process)}</span> },
    memoryColumn,
    cpuColumn,
    ageColumn,
    pidColumn
  ];

  return (
    <div className="view-stack">
      <div className="callout subtle">
        <ListChecks size={16} />
        <div>
          <strong>Review before stopping</strong>
          <p>These are user-owned processes with clear evidence they are no longer needed: orphaned helpers, idle dev servers, and background build jobs. Coding sessions and apps are never listed here.</p>
        </div>
      </div>
      <DataTable
        label="Cleanup candidates"
        rows={rows}
        columns={columns}
        getKey={(process) => process.pid}
        selectedKey={selectedPid}
        onSelect={(key) => onSelect(Number(key))}
        onActivate={(process) => onToggle(process.pid)}
        sort={sort}
        onSort={onSort}
        empty={<EmptyState icon={Sparkles} title="Nothing to clean up" detail="No orphaned or idle developer processes were found." />}
      />
      <div className="action-bar">
        <span>
          {selected.length
            ? `${pluralize(selected.length, 'process', 'processes')} selected · frees about ${formatKb(memoryKb)} and ${formatPercent(cpu)} CPU`
            : `${pluralize(rows.length, 'candidate')} · nothing stops until you confirm`}
        </span>
        <Button size="small" onClick={onToggleAll} disabled={!rows.length}>
          {allChecked ? 'Deselect All' : 'Select All'}
        </Button>
        <Button size="small" variant="danger" onClick={onReview} disabled={!selected.length}>
          Stop {selected.length || ''} Selected…
        </Button>
      </div>
    </div>
  );
}

