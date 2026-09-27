import { Bookmark, Copy, ExternalLink, FileDown, Flag, Power, Sparkles, SquareTerminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { AgentSession, AiExplanation, ProcessHistory, ProcessInfo } from '../../shared/types';
import { Sparkline } from '../components/Sparkline';
import { AgentMonogram, Button, Pill, ProcessGlyph, Property, PropertyList, Section, type Tone } from '../components/ui';
import { formatCpuTime, formatDuration, formatKb, formatPercent, formatRate, shortenPath } from '../lib/format';
import { CATEGORY_LABELS, localUrl, reviewReason } from '../lib/model';

const RISK: Record<ProcessInfo['riskLevel'], { tone: Tone; label: string }> = {
  low: { tone: 'good', label: 'Low risk' },
  medium: { tone: 'warning', label: 'Review' },
  high: { tone: 'critical', label: 'Flagged' },
  unknown: { tone: 'neutral', label: 'Unrated' }
};

interface ProcessInspectorProps {
  process: ProcessInfo;
  sampleKey: string;
  session: AgentSession | null;
  ruleState: 'keep' | 'flag' | 'none';
  aiExplanation: AiExplanation | null;
  aiLoading: boolean;
  hasApiKey: boolean;
  onExplain: () => void;
  onStop: () => void;
  onOpenUrl: (url: string) => void;
  onRule: (action: 'keep' | 'flag' | 'clear') => void;
  onExport: () => void;
  onCopy: (text: string, label: string) => void;
  onSelectProcess: (pid: number) => void;
  onSelectAgent: (id: string) => void;
}

export function ProcessInspector({
  process,
  sampleKey,
  session,
  ruleState,
  aiExplanation,
  aiLoading,
  hasApiKey,
  onExplain,
  onStop,
  onOpenUrl,
  onRule,
  onExport,
  onCopy,
  onSelectProcess,
  onSelectAgent
}: ProcessInspectorProps): JSX.Element {
  const [history, setHistory] = useState<ProcessHistory | null>(null);
  const url = localUrl(process);
  const risk = RISK[process.riskLevel];

  useEffect(() => {
    let cancelled = false;
    void window.metalExplorer
      .getProcessHistory(process.pid)
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [process.pid, sampleKey]);

  const samples = history?.pid === process.pid ? history.samples : [];

  return (
    <div className="inspector-content">
      <header className="inspector-hero">
        <span className="hero-glyph">
          <ProcessGlyph process={process} />
        </span>
        <div>
          <h2 title={process.name}>{process.name}</h2>
          <p>
            PID {process.pid} · {process.user}
          </p>
        </div>
      </header>

      <div className="badge-row">
        <Pill tone={risk.tone}>{risk.label}</Pill>
        <Pill>{process.tags.includes('coding-agent') ? 'Coding agent' : CATEGORY_LABELS[process.category]}</Pill>
        <Pill>{process.confidence} confidence</Pill>
        {ruleState !== 'none' ? <Pill tone="accent">{ruleState === 'keep' ? 'Always keep' : 'Always flag'}</Pill> : null}
      </div>

      <p className="inspector-lede">{reviewReason(process)}</p>

      <div className="action-grid">
        <Button icon={Sparkles} onClick={onExplain} disabled={aiLoading} title={hasApiKey ? 'Send a redacted summary to your AI provider' : 'Add an API key in Settings first'}>
          {aiLoading ? 'Explaining…' : 'Explain'}
        </Button>
        {url ? (
          <Button icon={ExternalLink} onClick={() => onOpenUrl(url)}>
            Open :{process.ports[0]?.port}
          </Button>
        ) : (
          <Button icon={Copy} onClick={() => onCopy(process.command, 'Command')}>
            Copy Command
          </Button>
        )}
        <Button icon={Power} variant="danger" onClick={onStop} disabled={!process.safeToTerminate} title={process.safeToTerminate ? 'Review and stop' : 'Protected: not stoppable from MetalExplorer'}>
          Stop…
        </Button>
      </div>

      {session ? (
        <button type="button" className="session-link" onClick={() => onSelectAgent(session.id)}>
          <AgentMonogram kind={session.kind} size={22} />
          <span>
            Part of <strong>{session.title ?? session.projectName}</strong> ({session.label})
          </span>
          <SquareTerminal size={13} />
        </button>
      ) : null}

      {aiExplanation ? (
        <Section title="AI explanation" className="ai-section">
          <p>{aiExplanation.summary}</p>
          <PropertyList>
            <Property label="Activity">{aiExplanation.activity}</Property>
            <Property label="Resources">{aiExplanation.resourceReason}</Property>
            <Property label="Safe to quit">{aiExplanation.safeToQuit}</Property>
            <Property label="Suggestion">{aiExplanation.recommendedAction}</Property>
          </PropertyList>
        </Section>
      ) : null}

      <Section title="Resources">
        <div className="inspector-chart">
          <div className="inspector-chart-label">
            <span>CPU</span>
            <strong className="mono">{formatPercent(process.cpuPercent)}</strong>
          </div>
          <Sparkline values={samples.map((sample) => sample.cpu)} capacity={60} height={44} tone="accent" label="CPU history" />
        </div>
        <div className="inspector-chart">
          <div className="inspector-chart-label">
            <span>Memory</span>
            <strong className="mono">{formatKb(process.rssKb)}</strong>
          </div>
          <Sparkline values={samples.map((sample) => sample.rssKb)} capacity={60} height={30} tone="teal" label="Memory history" />
        </div>
        <PropertyList>
          <Property label="CPU time" mono>
            {formatCpuTime(process.cpuTimeSeconds)}
          </Property>
          <Property label="Running for">{formatDuration(process.uptimeSeconds)}</Property>
          <Property label="Network" mono>
            ↓ {formatRate(process.network.downloadBps, process.network.status)} ↑ {formatRate(process.network.uploadBps, process.network.status)}
          </Property>
        </PropertyList>
      </Section>

      <Section title="Why MetalExplorer thinks so">
        <ul className="evidence">
          {process.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="rule-row">
          <Button size="small" icon={Bookmark} onClick={() => onRule(ruleState === 'keep' ? 'clear' : 'keep')}>
            {ruleState === 'keep' ? 'Remove Keep Rule' : 'Always Keep'}
          </Button>
          <Button size="small" icon={Flag} onClick={() => onRule(ruleState === 'flag' ? 'clear' : 'flag')}>
            {ruleState === 'flag' ? 'Remove Flag Rule' : 'Always Flag'}
          </Button>
        </div>
      </Section>

      <Section title="Origin">
        <PropertyList>
          <Property label="Executable" mono title={process.provenance.executablePath}>
            {shortenPath(process.provenance.executablePath)}
          </Property>
          <Property label="Parent">
            {process.provenance.parentName ? (
              <button type="button" className="link" onClick={() => onSelectProcess(process.ppid)}>
                {process.provenance.parentName} ({process.ppid})
              </button>
            ) : (
              process.ppid
            )}
          </Property>
          <Property label="Launched by">{process.provenance.launchMethod}</Property>
          {process.tty ? (
            <Property label="Terminal" mono>
              {process.tty}
            </Property>
          ) : null}
          {process.provenance.projectPath ? (
            <Property label="Project" mono title={process.provenance.projectPath}>
              {shortenPath(process.provenance.projectPath)}
            </Property>
          ) : null}
          <Property label="Group">{process.serviceGroup.label}</Property>
        </PropertyList>
      </Section>

      {process.ports.length ? (
        <Section title="Listening ports">
          <div className="port-list">
            {process.ports.map((port) => {
              const portUrl = localUrl(process, port);
              return (
                <button type="button" key={`${port.address}:${port.port}`} className="port-row" onClick={() => portUrl && onOpenUrl(portUrl)}>
                  <span className="mono">
                    {port.address}:{port.port}
                  </span>
                  <span className="muted">{port.address === '*' || port.address === '0.0.0.0' || port.address === '::' ? 'Network visible' : 'Local only'}</span>
                  <ExternalLink size={12} />
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}

      {process.networkConnections.length ? (
        <Section title={`Internet connections (${process.networkConnections.length})`}>
          <div className="connection-list">
            {process.networkConnections.slice(0, 12).map((connection) => (
              <div className="connection-row" key={`${connection.localPort}-${connection.remoteAddress}-${connection.remotePort}`}>
                <span className="mono truncate">
                  {connection.remoteAddress}:{connection.remotePort}
                </span>
                <span className="muted">
                  {connection.service}
                  {connection.encryptedLikely ? ' · encrypted' : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Command" trailing={<Button size="small" variant="plain" icon={Copy} onClick={() => onCopy(process.command, 'Command')} aria-label="Copy command" />}>
        <code className="command-block">{process.command}</code>
        <Button size="small" variant="plain" icon={FileDown} onClick={onExport}>
          Export Classification Report…
        </Button>
      </Section>
    </div>
  );
}
