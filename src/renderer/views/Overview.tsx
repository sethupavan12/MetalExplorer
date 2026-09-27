import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Info, OctagonAlert } from 'lucide-react';
import type { JSX } from 'react';
import type { AgentSession, ProcessInfo, ProcessSnapshot } from '../../shared/types';
import { Sparkline } from '../components/Sparkline';
import { AgentMonogram, Button, Meter, Pill, ProcessGlyph, StatusDot, type Tone } from '../components/ui';
import { formatBytes, formatKb, formatPercent, formatRate, formatTokens, pluralize } from '../lib/format';
import { AGENT_COLORS, agentTotals, buildFindings, type Finding, type ProcessFilters, type ViewId } from '../lib/model';

interface OverviewProps {
  snapshot: ProcessSnapshot;
  processes: ProcessInfo[];
  onNavigate: (view: ViewId, filters?: Partial<ProcessFilters>) => void;
  onSelectProcess: (pid: number, view?: ViewId) => void;
  onSelectAgent: (sessionId: string) => void;
}

const FINDING_ICONS = { critical: OctagonAlert, warning: AlertTriangle, info: Info, good: CheckCircle2 };

export function Overview({ snapshot, processes, onNavigate, onSelectProcess, onSelectAgent }: OverviewProps): JSX.Element {
  const { system } = snapshot;
  const findings = buildFindings(snapshot, processes);
  const history = system.history;
  const topCpu = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 6);
  const topMemory = [...processes].sort((a, b) => b.rssKb - a.rssKb).slice(0, 6);
  const memoryRatio = system.memoryTotalBytes ? system.memoryUsedBytes / system.memoryTotalBytes : 0;
  const pressureTone: Tone = system.memoryPressure === 'critical' ? 'critical' : system.memoryPressure === 'warning' ? 'warning' : 'good';
  const totals = agentTotals(snapshot.agents);

  return (
    <div className="overview scroll-area">
      <div className="gauge-grid">
        <article className="gauge">
          <header>
            <span>CPU</span>
            <small>{system.cpuCores} cores</small>
          </header>
          <strong className="gauge-value">{formatPercent(system.cpuUsagePercent)}</strong>
          <Sparkline values={history.map((sample) => sample.cpu)} max={100} capacity={120} height={44} tone="accent" label="CPU history" />
          <footer>
            <span>Load</span>
            <span className="mono">{system.loadAverage.map((value) => value.toFixed(2)).join('  ')}</span>
          </footer>
        </article>

        <article className="gauge">
          <header>
            <span>Memory</span>
            <Pill tone={pressureTone}>{system.memoryPressure === 'unknown' ? 'Pressure n/a' : `Pressure ${system.memoryPressure}`}</Pill>
          </header>
          <strong className="gauge-value">
            {formatBytes(system.memoryUsedBytes)}
            <small> of {formatBytes(system.memoryTotalBytes, 0)}</small>
          </strong>
          <Sparkline values={history.map((sample) => sample.memory)} max={100} capacity={120} height={44} tone={pressureTone === 'good' ? 'teal' : pressureTone} label="Memory history" />
          <footer>
            <span>{formatBytes(system.memoryCompressedBytes)} compressed</span>
            <span>{formatBytes(system.swapUsedBytes)} swap</span>
          </footer>
          <Meter value={memoryRatio * 100} tone={pressureTone === 'good' ? 'accent' : pressureTone} label="Memory used" />
        </article>

        <article className="gauge">
          <header>
            <span>Network</span>
            <small>{pluralize(snapshot.summary.externalConnections, 'connection')}</small>
          </header>
          <div className="gauge-split">
            <strong className="gauge-value">
              <ArrowDown size={15} strokeWidth={2.2} className="tone-text-accent" />
              {formatRate(system.networkDownloadBps)}
            </strong>
            <strong className="gauge-value">
              <ArrowUp size={15} strokeWidth={2.2} className="tone-text-purple" />
              {formatRate(system.networkUploadBps)}
            </strong>
          </div>
          <Sparkline
            values={history.map((sample) => sample.down)}
            secondary={history.map((sample) => sample.up)}
            capacity={120}
            height={44}
            tone="accent"
            secondaryTone="purple"
            label="Network history"
          />
          <footer>
            <span>{pluralize(snapshot.summary.internetProcesses, 'process', 'processes')} online</span>
            <button type="button" className="link" onClick={() => onNavigate('network')}>
              Details
            </button>
          </footer>
        </article>

        <article className="gauge gauge-agents" onClick={() => onNavigate('agents')} role="button" tabIndex={0}>
          <header>
            <span>Coding agents</span>
            <ChevronRight size={14} />
          </header>
          <strong className="gauge-value">
            {snapshot.agents.length}
            <small> {snapshot.agents.length === 1 ? 'session' : 'sessions'}</small>
          </strong>
          <div className="agent-stat-row">
            <span>
              <StatusDot tone="good" pulse={totals.working > 0} />
              {totals.working} working
            </span>
            {totals.waiting ? (
              <span>
                <StatusDot tone="warning" />
                {totals.waiting} need input
              </span>
            ) : null}
          </div>
          <footer>
            <span>CPU {formatPercent(totals.cpuPercent)}</span>
            <span>{totals.hasUsage ? `${formatTokens(totals.outputTokens)} out` : formatBytes(totals.memoryBytes)}</span>
          </footer>
        </article>
      </div>

      {snapshot.agents.length ? (
        <section className="overview-section">
          <header className="overview-section-header">
            <h2>Agent sessions</h2>
            <Button variant="plain" size="small" onClick={() => onNavigate('agents')}>
              Show all
            </Button>
          </header>
          <div className="agent-strip">
            {snapshot.agents.slice(0, 8).map((session) => (
              <AgentCard key={session.id} session={session} onClick={() => onSelectAgent(session.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="overview-columns">
        <section className="overview-section">
          <header className="overview-section-header">
            <h2>Needs attention</h2>
            <small>{findings.length ? pluralize(findings.length, 'item') : 'All clear'}</small>
          </header>
          <div className="list-card">
            {findings.length ? (
              findings.map((finding) => <FindingRow key={finding.id} finding={finding} onAction={() => runFinding(finding, onNavigate, onSelectProcess)} />)
            ) : (
              <div className="finding">
                <span className="finding-icon tone-good">
                  <CheckCircle2 size={16} />
                </span>
                <div>
                  <strong>Nothing stands out</strong>
                  <p>No unknown listeners, orphaned processes, or pressure right now.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="overview-section">
          <header className="overview-section-header">
            <h2>Top CPU</h2>
            <Button variant="plain" size="small" onClick={() => onNavigate('processes')}>
              All processes
            </Button>
          </header>
          <div className="list-card">
            {topCpu.map((process) => (
              <ConsumerRow key={process.pid} process={process} value={formatPercent(process.cpuPercent)} ratio={process.cpuPercent / Math.max(100, topCpu[0]?.cpuPercent ?? 100)} onClick={() => onSelectProcess(process.pid)} />
            ))}
          </div>
        </section>

        <section className="overview-section">
          <header className="overview-section-header">
            <h2>Top memory</h2>
          </header>
          <div className="list-card">
            {topMemory.map((process) => (
              <ConsumerRow key={process.pid} process={process} value={formatKb(process.rssKb)} ratio={process.rssKb / (topMemory[0]?.rssKb || 1)} onClick={() => onSelectProcess(process.pid)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function runFinding(finding: Finding, onNavigate: OverviewProps['onNavigate'], onSelectProcess: OverviewProps['onSelectProcess']): void {
  if (finding.action.pid) {
    onSelectProcess(finding.action.pid, finding.action.view);
    return;
  }
  onNavigate(finding.action.view, finding.action.filters);
}

function FindingRow({ finding, onAction }: { finding: Finding; onAction: () => void }): JSX.Element {
  const Icon = FINDING_ICONS[finding.tone];
  return (
    <div className="finding">
      <span className={`finding-icon tone-${finding.tone}`}>
        <Icon size={16} />
      </span>
      <div>
        <strong>{finding.title}</strong>
        <p>{finding.detail}</p>
      </div>
      <Button size="small" onClick={onAction}>
        {finding.action.label}
      </Button>
    </div>
  );
}

function ConsumerRow({ process, value, ratio, onClick }: { process: ProcessInfo; value: string; ratio: number; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="consumer-row" onClick={onClick}>
      <ProcessGlyph process={process} />
      <span className="consumer-name">{process.name}</span>
      <span className="consumer-bar">
        <i style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }} />
      </span>
      <span className="consumer-value mono">{value}</span>
    </button>
  );
}

export function AgentCard({ session, onClick }: { session: AgentSession; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={`agent-card status-${session.status}`} onClick={onClick} style={{ ['--agent-color' as string]: AGENT_COLORS[session.kind] }}>
      <div className="agent-card-top">
        <AgentMonogram kind={session.kind} size={26} />
        <div className="agent-card-title">
          <strong>{session.title ?? session.projectName}</strong>
          <span>
            {session.label}
            {session.host ? ` · ${session.host.name}` : ''}
          </span>
        </div>
        <AgentStatus session={session} compact />
      </div>
      <Sparkline values={session.cpuHistory} capacity={60} height={26} tone="agent" label={`${session.projectName} CPU history`} />
      <div className="agent-card-stats">
        <span className="mono">{formatPercent(session.cpuPercent)}</span>
        <span className="mono">{formatBytes(session.memoryBytes)}</span>
        <span className="mono">{session.usage ? `${formatTokens(session.usage.totalTokens)} tok` : `${session.processCount} proc`}</span>
      </div>
    </button>
  );
}

export function AgentStatus({ session, compact = false }: { session: AgentSession; compact?: boolean }): JSX.Element {
  const label = session.status === 'working' ? 'Working' : session.status === 'waiting' ? 'Needs input' : 'Idle';
  const tone: Tone = session.status === 'working' ? 'good' : session.status === 'waiting' ? 'warning' : 'neutral';
  const title = session.statusSource === 'agent' ? 'Reported by the agent' : 'Estimated from CPU and transcript activity';
  if (compact) {
    return (
      <span className="agent-status-compact" title={`${label} · ${title}`}>
        <StatusDot tone={tone} pulse={session.status === 'working'} />
      </span>
    );
  }
  return (
    <Pill tone={tone} title={title}>
      <StatusDot tone={tone} pulse={session.status === 'working'} />
      {label}
    </Pill>
  );
}
