import { OctagonAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { AgentSession, ProcessInfo, TerminateTarget } from '../../shared/types';
import { formatKb, formatPercent, pluralize } from '../lib/format';
import { cleanupReason, portsText, reviewReason } from '../lib/model';
import { Button, ProcessGlyph } from './ui';

/** A frozen copy of what the user is reviewing. The sheet never re-reads live data while open. */
export interface StopRequest {
  targets: ProcessInfo[];
  sampledAt: string;
  session?: AgentSession;
  source: 'process' | 'cleanup' | 'agent';
}

export function stopTargets(request: StopRequest): TerminateTarget[] {
  const sampledSeconds = Math.round(Date.parse(request.sampledAt) / 1000);
  return request.targets
    .filter((process) => process.safeToTerminate)
    .map((process) => ({ pid: process.pid, startedAt: sampledSeconds - process.uptimeSeconds, command: process.command }));
}

interface StopSheetProps {
  request: StopRequest;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Modal review sheet. Nothing is stopped until the destructive button is pressed. */
export function StopSheet({ request, busy, onCancel, onConfirm }: StopSheetProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const targets = request.targets;
  const stoppable = targets.filter((process) => process.safeToTerminate);
  const session = request.session;
  // A session stop ends the whole tree, so report the tree's footprint rather than the root process alone.
  const memoryKb = session ? session.memoryBytes / 1024 : stoppable.reduce((total, process) => total + process.rssKb, 0);
  const cpu = session ? session.cpuPercent : stoppable.reduce((total, process) => total + process.cpuPercent, 0);
  const ports = session ? session.ports : stoppable.flatMap((process) => process.ports);
  const connections = session ? session.connectionCount : stoppable.reduce((total, process) => total + process.networkConnections.length, 0);

  // Focus Cancel once when the sheet opens; later renders must not steal focus from the Stop button.
  useEffect(() => {
    cancelRef.current?.focus();
    const handle = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancelRef.current();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const title = session
    ? `Stop ${session.label} session “${session.title ?? session.projectName}”?`
    : stoppable.length === 1
      ? `Stop “${stoppable[0].name}”?`
      : `Stop ${pluralize(stoppable.length, 'process', 'processes')}?`;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="stop-title" aria-describedby="stop-detail" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheet-icon">
          <OctagonAlert size={28} strokeWidth={1.6} />
        </div>
        <h2 id="stop-title">{title}</h2>
        <p id="stop-detail" className="sheet-detail">
          {session
            ? `MetalExplorer sends SIGTERM to the agent (PID ${session.rootPid}). Its ${pluralize(session.processCount - 1, 'child process', 'child processes')} usually exit with it. Any in-progress turn stops and unsaved work in that terminal may be lost.`
            : 'MetalExplorer sends SIGTERM so each process can shut down cleanly. Unsaved work in these processes may be lost.'}
        </p>

        <div className="sheet-impact">
          <div>
            <span>Memory</span>
            <strong className="mono">{formatKb(memoryKb)}</strong>
          </div>
          <div>
            <span>CPU</span>
            <strong className="mono">{formatPercent(cpu)}</strong>
          </div>
          <div>
            <span>Ports closing</span>
            <strong className="mono">{ports.length ? ports.map((port) => port.port).slice(0, 4).join(', ') : 'None'}</strong>
          </div>
          <div>
            <span>Connections</span>
            <strong className="mono">{connections}</strong>
          </div>
        </div>

        {!session ? (
          <div className="sheet-list">
            {targets.map((process) => (
              <div key={process.pid} className={`sheet-row ${process.safeToTerminate ? '' : 'is-blocked'}`}>
                <ProcessGlyph process={process} />
                <div>
                  <strong>
                    {process.name} <span className="mono muted">{process.pid}</span>
                  </strong>
                  <span>
                    {process.safeToTerminate
                      ? request.source === 'cleanup'
                        ? cleanupReason(process)
                        : process.ports.length
                          ? `Closes ${portsText(process)}`
                          : reviewReason(process)
                      : 'Protected: will be skipped'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="sheet-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary btn-large" onClick={onCancel}>
            <span>Cancel</span>
          </button>
          <Button variant="danger" size="large" onClick={onConfirm} disabled={busy || !stoppable.length}>
            {busy ? 'Stopping…' : session ? 'Stop Session' : stoppable.length === 1 ? 'Stop Process' : `Stop ${stoppable.length}`}
          </Button>
        </div>
      </section>
    </div>
  );
}
