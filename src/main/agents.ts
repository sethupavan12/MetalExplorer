import type { AgentChildProcess, AgentHost, AgentSession, AgentSessionStatus, AgentUsage, ListeningPort, ProcessInfo } from '../shared/types';
import { basename, detectCodingAgent, splitArgs, type CodingAgentDefinition } from './agent-catalog';
import { redactCommandForAi } from './ai';

const MULTIPLEXERS = new Set(['tmux', 'zellij', 'screen', 'herdr', 'abduco', 'dtach', 'tmate']);
const HOST_ALIASES: Record<string, string> = {
  iTerm: 'iTerm2',
  Code: 'VS Code',
  'Visual Studio Code': 'VS Code',
  'Visual Studio Code - Insiders': 'VS Code Insiders',
  Terminal: 'Terminal'
};
const ACTIVE_CPU_PERCENT = 2;
const RECENT_ACTIVITY_MS = 15_000;
const MAX_CHILDREN = 16;

/** State Claude Code publishes in `~/.claude/sessions/<pid>.json`. Only these fields are read. */
export interface ClaudeSessionState {
  sessionId: string | null;
  cwd: string | null;
  name: string | null;
  status: string | null;
}

export interface AgentTrackerState {
  history: Map<string, { cpu: number[]; memory: number[] }>;
  cpuTime: Map<string, { members: Map<number, number>; exited: number }>;
}

export function createAgentTrackerState(): AgentTrackerState {
  return { history: new Map(), cpuTime: new Map() };
}

export interface AgentRoot {
  process: ProcessInfo;
  agent: CodingAgentDefinition;
  sessionId: string;
}

/** Top-level agent processes. Agents started by another agent count toward the outer session. */
export function findAgentRoots(processes: ProcessInfo[]): AgentRoot[] {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const agents = new Map<number, CodingAgentDefinition>();
  for (const process of processes) {
    const agent = detectCodingAgent(process);
    if (agent) {
      agents.set(process.pid, agent);
    }
  }

  const roots: AgentRoot[] = [];
  for (const [pid, agent] of agents) {
    let ancestor = byPid.get(byPid.get(pid)?.ppid ?? -1);
    let nested = false;
    const seen = new Set<number>();
    while (ancestor && ancestor.pid > 1 && !seen.has(ancestor.pid)) {
      seen.add(ancestor.pid);
      if (agents.has(ancestor.pid)) {
        nested = true;
        break;
      }
      ancestor = byPid.get(ancestor.ppid);
    }

    const process = byPid.get(pid);
    if (!nested && process) {
      roots.push({ process, agent, sessionId: `${agent.kind}:${pid}` });
    }
  }

  return roots.sort((a, b) => a.process.pid - b.process.pid);
}

export interface AgentSessionInputs {
  cwdByPid: Map<number, string>;
  claudeStates: Map<number, ClaudeSessionState>;
  usageBySession: Map<string, AgentUsage>;
  state: AgentTrackerState;
  historyLength: number;
  now: number;
}

export function buildAgentSessions(processes: ProcessInfo[], roots: AgentRoot[], inputs: AgentSessionInputs): AgentSession[] {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const childrenByPid = new Map<number, ProcessInfo[]>();
  for (const process of processes) {
    const siblings = childrenByPid.get(process.ppid) ?? [];
    siblings.push(process);
    childrenByPid.set(process.ppid, siblings);
  }

  const liveIds = new Set<string>();
  const sessions = roots.map(({ process: root, agent, sessionId }): AgentSession => {
    liveIds.add(sessionId);
    const members = collectTree(root, childrenByPid);
    for (const member of members) {
      member.process.agentSessionId = sessionId;
    }

    const cpuPercent = round(members.reduce((total, member) => total + member.process.cpuPercent, 0));
    const memoryBytes = members.reduce((total, member) => total + member.process.rssKb * 1024, 0);
    const history = pushHistory(inputs.state, sessionId, cpuPercent, memoryBytes, inputs.historyLength);
    const claudeState = agent.kind === 'claude' ? inputs.claudeStates.get(root.pid) ?? null : null;
    const usage = inputs.usageBySession.get(sessionId) ?? null;
    const cwd = claudeState?.cwd ?? inputs.cwdByPid.get(root.pid) ?? null;
    const { host, multiplexer } = detectHost(root, byPid);
    const { status, statusSource } = detectStatus(claudeState, usage, history.cpu, inputs.now);
    const ports = uniquePorts(members.flatMap((member) => member.process.ports));

    return {
      id: sessionId,
      kind: agent.kind,
      label: agent.label,
      title: claudeState?.name ?? null,
      rootPid: root.pid,
      tty: root.tty,
      cwd,
      projectName: cwd ? basename(cwd) || cwd : agent.label,
      host,
      multiplexer,
      uptimeSeconds: root.uptimeSeconds,
      status,
      statusSource,
      cpuPercent,
      memoryBytes,
      cpuTimeSeconds: trackCpuTime(inputs.state, sessionId, members),
      processCount: members.length,
      cpuHistory: [...history.cpu],
      memoryHistory: [...history.memory],
      ports,
      connectionCount: members.reduce((total, member) => total + member.process.networkConnections.length, 0),
      downloadBps: members.reduce((total, member) => total + (member.process.network.downloadBps ?? 0), 0),
      uploadBps: members.reduce((total, member) => total + (member.process.network.uploadBps ?? 0), 0),
      children: members
        .filter((member) => member.depth > 0)
        .sort((a, b) => b.process.cpuPercent - a.process.cpuPercent || b.process.rssKb - a.process.rssKb)
        .slice(0, MAX_CHILDREN)
        .map(
          (member): AgentChildProcess => ({
            pid: member.process.pid,
            name: member.process.name,
            cpuPercent: member.process.cpuPercent,
            rssKb: member.process.rssKb,
            commandPreview: redactCommandForAi(member.process.provenance.commandPreview),
            depth: member.depth
          })
        ),
      commandPreview: redactCommandForAi(root.command).slice(0, 240),
      resumeId: claudeState?.sessionId ?? usage?.sessionId ?? parseResumeId(root.command),
      usage,
      safeToTerminate: root.safeToTerminate
    };
  });

  for (const id of inputs.state.history.keys()) {
    if (!liveIds.has(id)) {
      inputs.state.history.delete(id);
      inputs.state.cpuTime.delete(id);
    }
  }

  // Stable order (oldest session first) so rows do not jump between samples.
  return sessions.sort((a, b) => b.uptimeSeconds - a.uptimeSeconds || a.rootPid - b.rootPid);
}

export function parseResumeId(command: string): string | null {
  const tokens = splitArgs(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const inline = token.match(/^--(?:resume|session-id)=(.+)$/);
    if (inline) {
      return inline[1];
    }
    if ((token === '--resume' || token === '-r' || token === '--session-id' || token === 'resume') && tokens[index + 1] && !tokens[index + 1].startsWith('-')) {
      return tokens[index + 1];
    }
  }
  return null;
}

export function parseClaudeSessionState(raw: string): ClaudeSessionState | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
    return { sessionId: text(parsed.sessionId), cwd: text(parsed.cwd), name: text(parsed.name), status: text(parsed.status) };
  } catch {
    return null;
  }
}

export function parseLsofCwdOutput(output: string): Map<number, string> {
  const byPid = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number.parseInt(line.slice(1), 10);
    } else if (line.startsWith('n') && pid !== null && Number.isFinite(pid)) {
      byPid.set(pid, line.slice(1));
    }
  }
  return byPid;
}

function collectTree(root: ProcessInfo, childrenByPid: Map<number, ProcessInfo[]>): Array<{ process: ProcessInfo; depth: number }> {
  const members: Array<{ process: ProcessInfo; depth: number }> = [];
  const queue: Array<{ process: ProcessInfo; depth: number }> = [{ process: root, depth: 0 }];
  const seen = new Set<number>();
  while (queue.length) {
    const next = queue.shift();
    if (!next || seen.has(next.process.pid)) {
      continue;
    }
    seen.add(next.process.pid);
    members.push(next);
    for (const child of childrenByPid.get(next.process.pid) ?? []) {
      queue.push({ process: child, depth: next.depth + 1 });
    }
  }
  return members;
}

function detectHost(root: ProcessInfo, byPid: Map<number, ProcessInfo>): { host: AgentHost | null; multiplexer: string | null } {
  let multiplexer: string | null = null;
  let ancestor = byPid.get(root.ppid);
  const seen = new Set<number>();

  while (ancestor && ancestor.pid > 1 && !seen.has(ancestor.pid)) {
    seen.add(ancestor.pid);
    const name = basename(ancestor.provenance.executablePath).toLowerCase();
    if (!multiplexer && (MULTIPLEXERS.has(name) || MULTIPLEXERS.has(ancestor.name.toLowerCase()))) {
      multiplexer = MULTIPLEXERS.has(name) ? name : ancestor.name.toLowerCase();
    }

    const bundle = ancestor.provenance.appBundle;
    if (bundle) {
      const appPath = ancestor.provenance.executablePath.match(/^(.*?\.app)\//)?.[1] ?? null;
      return { host: { name: HOST_ALIASES[bundle] ?? bundle, pid: ancestor.pid, appPath }, multiplexer };
    }

    ancestor = byPid.get(ancestor.ppid);
  }

  return { host: null, multiplexer };
}

function detectStatus(
  claudeState: ClaudeSessionState | null,
  usage: AgentUsage | null,
  cpuHistory: number[],
  now: number
): { status: AgentSessionStatus; statusSource: AgentSession['statusSource'] } {
  if (claudeState?.status) {
    if (claudeState.status === 'busy' || claudeState.status === 'shell') {
      return { status: 'working', statusSource: 'agent' };
    }
    if (claudeState.status === 'idle') {
      return { status: 'waiting', statusSource: 'agent' };
    }
  }

  const lastActivity = usage?.lastActivityAt ? Date.parse(usage.lastActivityAt) : Number.NaN;
  if (Number.isFinite(lastActivity) && now - lastActivity < RECENT_ACTIVITY_MS) {
    return { status: 'working', statusSource: 'activity' };
  }

  const recent = cpuHistory.slice(-3);
  const average = recent.length ? recent.reduce((total, value) => total + value, 0) / recent.length : 0;
  return { status: average >= ACTIVE_CPU_PERCENT ? 'working' : 'idle', statusSource: 'activity' };
}

function pushHistory(state: AgentTrackerState, id: string, cpu: number, memory: number, length: number): { cpu: number[]; memory: number[] } {
  const history = state.history.get(id) ?? { cpu: [], memory: [] };
  history.cpu.push(cpu);
  history.memory.push(memory);
  if (history.cpu.length > length) {
    history.cpu.splice(0, history.cpu.length - length);
    history.memory.splice(0, history.memory.length - length);
  }
  state.history.set(id, history);
  return history;
}

function trackCpuTime(state: AgentTrackerState, id: string, members: Array<{ process: ProcessInfo }>): number {
  const tracked = state.cpuTime.get(id) ?? { members: new Map<number, number>(), exited: 0 };
  const current = new Map(members.map((member) => [member.process.pid, member.process.cpuTimeSeconds]));
  for (const [pid, cpuTime] of tracked.members) {
    if (!current.has(pid)) {
      tracked.exited += cpuTime;
    }
  }
  tracked.members = current;
  state.cpuTime.set(id, tracked);
  const live = [...current.values()].reduce((total, value) => total + value, 0);
  return Math.round((tracked.exited + live) * 10) / 10;
}

function uniquePorts(ports: ListeningPort[]): ListeningPort[] {
  const byPort = new Map<number, ListeningPort>();
  for (const port of ports) {
    byPort.set(port.port, byPort.get(port.port) ?? port);
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
