import { AppWindow, Copy, ExternalLink, FolderOpen, Gauge, Power, Sparkles, SquareTerminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { AgentSession, AppSettings } from '../../shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { Sparkline } from '../components/Sparkline';
import { AgentMonogram, Button, EmptyState, Meter, Property, PropertyList, Section, Segmented } from '../components/ui';
import { formatBytes, formatCpuTime, formatDuration, formatPercent, formatRate, formatRelativeTime, formatTokens, pluralize, compactPath } from '../lib/format';
import { AGENT_COLORS, agentResumeCommand, agentTotals } from '../lib/model';
import { AgentStatus } from './Overview';

export type AgentStatusFilter = 'all' | 'working' | 'waiting' | 'idle';

interface AgentsViewProps {
  agents: AgentSession[];
  query: string;
  selectedId: string | null;
  settings: AppSettings | null;
  onSelect: (id: string) => void;
  onEnableInsights: () => void;
  onFocusHost: (session: AgentSession) => void;
}

export function AgentsView({ agents, query, selectedId, settings, onSelect, onEnableInsights, onFocusHost }: AgentsViewProps): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const totals = agentTotals(agents);
  const normalized = query.trim().toLowerCase();

  const rows = useMemo(
    () =>
      agents.filter((session) => {
        if (statusFilter !== 'all' && session.status !== statusFilter) return false;
        if (!normalized) return true;
        return [session.label, session.title, session.projectName, session.cwd, session.host?.name, session.tty, session.usage?.model, session.rootPid]
          .join(' ')
          .toLowerCase()
          .includes(normalized);
      }),
    [agents, normalized, statusFilter]
  );

  const columns: Array<Column<AgentSession>> = [
    {
      id: 'session',
      title: 'Session',
      width: 'minmax(200px, 2.4fr)',
      render: (session) => (
        <div className="session-cell">
          <AgentMonogram kind={session.kind} size={28} />
          <div>
            <strong>{session.title ?? session.projectName}</strong>
            <span title={session.cwd ?? undefined}>
              {[session.label, session.host?.name, session.tty].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>
      )
    },
    { id: 'status', title: 'Status', width: '112px', render: (session) => <AgentStatus session={session} /> },
    {
      id: 'cpu',
      title: 'CPU',
      width: '136px',
      align: 'right',
      render: (session) => (
        <div className="cpu-cell" style={agentColorStyle(session)}>
          <Sparkline values={session.cpuHistory} capacity={60} height={22} tone="agent" />
          <span className="mono">{formatPercent(session.cpuPercent)}</span>
        </div>
      )
    },
    { id: 'memory', title: 'Memory', width: '80px', align: 'right', render: (session) => <span className="mono">{formatBytes(session.memoryBytes)}</span> },
    ...(settings?.agentUsage
      ? [
          {
            id: 'tokens',
            title: 'Tokens',
            width: '76px',
            align: 'right' as const,
            render: (session: AgentSession) => <span className="mono">{session.usage ? formatTokens(session.usage.totalTokens) : '—'}</span>
          }
        ]
      : []),
    {
      id: 'procs',
      title: 'Procs',
      width: '54px',
      align: 'right',
      render: (session) => <span className="mono">{session.processCount}</span>
    },
    { id: 'uptime', title: 'Uptime', width: '72px', align: 'right', render: (session) => <span className="mono muted">{formatDuration(session.uptimeSeconds)}</span> }
  ];

  return (
    <div className="view-stack">
      <div className="agents-summary">
        <div className="agents-summary-stats">
          <SummaryStat label="Sessions" value={String(agents.length)} />
          <SummaryStat label="Working" value={String(totals.working)} />
          <SummaryStat label="Needs input" value={String(totals.waiting)} />
          <SummaryStat label="CPU" value={formatPercent(totals.cpuPercent)} />
          <SummaryStat label="Memory" value={formatBytes(totals.memoryBytes)} />
          {totals.hasUsage ? <SummaryStat label="Tokens" value={formatTokens(totals.totalTokens)} /> : null}
        </div>
        <Segmented<AgentStatusFilter>
          label="Filter sessions by status"
          size="small"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'working', label: 'Working' },
            { id: 'waiting', label: 'Needs input' },
            { id: 'idle', label: 'Idle' }
          ]}
        />
      </div>

      {settings && !settings.agentUsage && agents.length ? (
        <div className="callout">
          <Sparkles size={16} className="tone-text-accent" />
          <div>
            <strong>See tokens, model, and exact status</strong>
            <p>MetalExplorer can read the usage counters Claude Code and Codex already keep in ~/.claude and ~/.codex. Only numbers and names are read, and nothing leaves this Mac.</p>
          </div>
          <Button variant="primary" size="small" onClick={onEnableInsights}>
            Turn On
          </Button>
        </div>
      ) : null}

      <DataTable
        label="Coding agent sessions"
        rows={rows}
        columns={columns}
        rowHeight={50}
        getKey={(session) => session.id}
        selectedKey={selectedId}
        onSelect={(key) => onSelect(String(key))}
        onActivate={onFocusHost}
        empty={
          <EmptyState
            icon={SquareTerminal}
            title={agents.length ? 'No sessions match' : 'No coding agents running'}
            detail={agents.length ? 'Try a different status or search.' : 'Start Claude Code, Codex, OpenCode, Gemini CLI, Aider, Amp, or another agent in any terminal and it appears here.'}
          />
        }
      />
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="summary-stat">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

interface AgentInspectorProps {
  session: AgentSession;
  settings: AppSettings | null;
  onFocusHost: (session: AgentSession) => void;
  onReveal: (session: AgentSession) => void;
  onCopy: (text: string, label: string) => void;
  onStop: (session: AgentSession) => void;
  onSelectProcess: (pid: number) => void;
  onOpenUrl: (url: string) => void;
  onEnableInsights: () => void;
}

export function AgentInspector({ session, settings, onFocusHost, onReveal, onCopy, onStop, onSelectProcess, onOpenUrl, onEnableInsights }: AgentInspectorProps): JSX.Element {
  const resume = agentResumeCommand(session);
  const usage = session.usage;
  const contextRatio = usage?.contextTokens && usage.contextWindow ? usage.contextTokens / usage.contextWindow : null;

  return (
    <div className="inspector-content" style={agentColorStyle(session)}>
      <header className="inspector-hero">
        <AgentMonogram kind={session.kind} size={40} />
        <div>
          <h2 title={session.title ?? session.projectName}>{session.title ?? session.projectName}</h2>
          <p>
            {session.label} · PID {session.rootPid}
          </p>
        </div>
        <AgentStatus session={session} />
      </header>

      <div className="action-grid">
        <Button icon={AppWindow} onClick={() => onFocusHost(session)} disabled={!session.host?.appPath} title={session.host ? `Bring ${session.host.name} to the front` : 'No terminal app found'}>
          {session.host ? session.host.name : 'No terminal'}
        </Button>
        <Button icon={FolderOpen} onClick={() => onReveal(session)} disabled={!session.cwd}>
          Open Folder
        </Button>
        <Button icon={Copy} onClick={() => resume && onCopy(resume, 'Resume command')} disabled={!resume}>
          Copy Resume
        </Button>
        <Button icon={Power} variant="danger" onClick={() => onStop(session)} disabled={!session.safeToTerminate}>
          Stop Session…
        </Button>
      </div>

      <Section title="Compute">
        <div className="inspector-chart">
          <div className="inspector-chart-label">
            <span>CPU</span>
            <strong className="mono">{formatPercent(session.cpuPercent)}</strong>
          </div>
          <Sparkline values={session.cpuHistory} capacity={60} height={52} tone="agent" label="Session CPU history" />
        </div>
        <div className="inspector-chart">
          <div className="inspector-chart-label">
            <span>Memory</span>
            <strong className="mono">{formatBytes(session.memoryBytes)}</strong>
          </div>
          <Sparkline values={session.memoryHistory} capacity={60} height={36} tone="teal" label="Session memory history" />
        </div>
        <PropertyList>
          <Property label="CPU time" mono>
            {formatCpuTime(session.cpuTimeSeconds)}
          </Property>
          <Property label="Processes">{pluralize(session.processCount, 'process', 'processes')}</Property>
          <Property label="Network" mono>
            ↓ {formatRate(session.downloadBps)} ↑ {formatRate(session.uploadBps)}
          </Property>
          <Property label="Connections">{session.connectionCount}</Property>
          <Property label="Running for">{formatDuration(session.uptimeSeconds)}</Property>
        </PropertyList>
      </Section>

      <Section title="Tokens">
        {usage ? (
          <>
            <div className="token-hero">
              <div>
                <strong className="mono">{formatTokens(usage.totalTokens)}</strong>
                <span>total tokens</span>
              </div>
              <div>
                <strong className="mono">{formatTokens(usage.outputTokens)}</strong>
                <span>output</span>
              </div>
              <div>
                <strong className="mono">{usage.turns}</strong>
                <span>{usage.source === 'codex-rollout' ? 'turns' : 'responses'}</span>
              </div>
            </div>
            {usage.contextTokens !== null ? (
              <div className="context-meter">
                <div className="inspector-chart-label">
                  <span>Context in last turn</span>
                  <strong className="mono">
                    {formatTokens(usage.contextTokens)}
                    {usage.contextWindow ? ` / ${formatTokens(usage.contextWindow)}` : ''}
                  </strong>
                </div>
                {contextRatio !== null ? <Meter value={contextRatio * 100} tone={contextRatio > 0.85 ? 'critical' : contextRatio > 0.65 ? 'warning' : 'accent'} label="Context used" /> : null}
              </div>
            ) : null}
            <PropertyList>
              <Property label="Model" mono>
                {usage.model ?? '—'}
              </Property>
              <Property label="Input" mono>
                {formatTokens(usage.inputTokens)}
              </Property>
              <Property label="Cache read" mono>
                {formatTokens(usage.cacheReadTokens)}
              </Property>
              {usage.cacheWriteTokens ? (
                <Property label="Cache write" mono>
                  {formatTokens(usage.cacheWriteTokens)}
                </Property>
              ) : null}
              {usage.reasoningTokens ? (
                <Property label="Reasoning" mono>
                  {formatTokens(usage.reasoningTokens)}
                </Property>
              ) : null}
              {usage.gitBranch ? (
                <Property label="Branch" mono>
                  {usage.gitBranch}
                </Property>
              ) : null}
              <Property label="Last activity">{formatRelativeTime(usage.lastActivityAt)}</Property>
            </PropertyList>
          </>
        ) : settings?.agentUsage ? (
          <p className="muted-note">
            {session.kind === 'claude' || session.kind === 'codex'
              ? 'No usage recorded for this session yet.'
              : `${session.label} does not publish token usage in a format MetalExplorer reads yet.`}
          </p>
        ) : (
          <div className="inline-callout">
            <Gauge size={15} />
            <p>Turn on session insights to read token counts from local agent logs.</p>
            <Button size="small" onClick={onEnableInsights}>
              Turn On
            </Button>
          </div>
        )}
      </Section>

      <Section title="Location">
        <PropertyList>
          <Property label="Folder" mono title={session.cwd ?? undefined}>
            {compactPath(session.cwd, 34)}
          </Property>
          <Property label="Terminal">{session.host?.name ?? 'Not found'}</Property>
          {session.multiplexer ? <Property label="Multiplexer">{session.multiplexer}</Property> : null}
          <Property label="TTY" mono>
            {session.tty ?? '—'}
          </Property>
          {session.resumeId ? (
            <Property label="Session ID" mono title={session.resumeId}>
              {session.resumeId}
            </Property>
          ) : null}
        </PropertyList>
        <code className="command-block">{session.commandPreview}</code>
      </Section>

      {session.ports.length ? (
        <Section title="Servers started">
          <div className="port-list">
            {session.ports.map((port) => {
              const host = port.address === '*' || port.address === '0.0.0.0' || port.address === '::' ? 'localhost' : port.address.includes(':') ? `[${port.address}]` : port.address;
              const url = `http://${host}:${port.port}`;
              return (
                <button type="button" key={port.port} className="port-row" onClick={() => onOpenUrl(url)}>
                  <span className="mono">:{port.port}</span>
                  <span className="muted">{port.address === '*' || port.address === '0.0.0.0' ? 'Network visible' : 'Local only'}</span>
                  <ExternalLink size={12} />
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section title="Process tree" trailing={<small className="muted">{session.children.length < session.processCount - 1 ? `Top ${session.children.length}` : null}</small>}>
        <div className="tree-list">
          <button type="button" className="tree-row" onClick={() => onSelectProcess(session.rootPid)}>
            <span className="tree-name">
              <strong>{session.label}</strong>
            </span>
            <span className="mono muted">{session.rootPid}</span>
          </button>
          {session.children.map((child) => (
            <button type="button" key={child.pid} className="tree-row" onClick={() => onSelectProcess(child.pid)} title={child.commandPreview}>
              <span className="tree-name" style={{ paddingLeft: Math.min(child.depth, 5) * 12 }}>
                <span className="tree-elbow" />
                {child.name}
              </span>
              <span className="mono">{formatPercent(child.cpuPercent)}</span>
              <span className="mono muted">{formatBytes(child.rssKb * 1024)}</span>
            </button>
          ))}
          {!session.children.length ? <p className="muted-note">No child processes right now.</p> : null}
        </div>
      </Section>
    </div>
  );
}

export function agentColorStyle(session: AgentSession): CSSProperties {
  return { ['--agent-color' as string]: AGENT_COLORS[session.kind] };
}
