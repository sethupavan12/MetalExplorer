import type { AgentSession, CodingAgentKind, ProcessCategory, ProcessInfo, ProcessSnapshot } from '../../shared/types';
import { formatBytes, formatRate, pluralize } from './format';

export type ViewId = 'overview' | 'agents' | 'processes' | 'services' | 'network' | 'cleanup' | 'settings';
export const VIEW_IDS: ViewId[] = ['overview', 'agents', 'processes', 'services', 'network', 'cleanup', 'settings'];

export type ProcessScope = 'mine' | 'all' | 'system';
export type CategoryFilter = 'all' | ProcessCategory;
export type ActivityFilter = 'all' | 'review' | 'internet' | 'listening' | 'orphaned' | 'high-cpu' | 'high-memory';

export interface ProcessFilters {
  scope: ProcessScope;
  category: CategoryFilter;
  activity: ActivityFilter;
}

export const DEFAULT_FILTERS: ProcessFilters = { scope: 'all', category: 'all', activity: 'all' };

export type SortKey =
  | 'name'
  | 'cpuPercent'
  | 'cpuTimeSeconds'
  | 'rssKb'
  | 'ports'
  | 'network'
  | 'pid'
  | 'user'
  | 'category'
  | 'uptimeSeconds'
  | 'connections';

export interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export type UserRulePreset = 'balanced' | 'focus' | 'deep-dev' | 'strict';
export interface UserRules {
  preset: UserRulePreset;
  keep: string[];
  flag: string[];
}
export const DEFAULT_RULES: UserRules = { preset: 'balanced', keep: [], flag: [] };
export const RULE_PRESETS: Array<{ id: UserRulePreset; label: string; detail: string }> = [
  { id: 'balanced', label: 'Balanced', detail: 'Default evidence-based flags' },
  { id: 'focus', label: 'Focus', detail: 'Flag heavy CPU and network use' },
  { id: 'deep-dev', label: 'Deep dev', detail: 'Quiet for servers, databases, agents' },
  { id: 'strict', label: 'Strict', detail: 'Escalate unknown network activity' }
];

export const CATEGORY_LABELS: Record<ProcessCategory, string> = {
  'macos-system': 'System',
  'local-server': 'Dev server',
  'ai-agent': 'AI',
  'developer-tool': 'Dev tool',
  database: 'Database',
  browser: 'Browser',
  'user-app': 'App',
  unknown: 'Unknown'
};

export const AGENT_COLORS: Record<CodingAgentKind, string> = {
  claude: '#d97757',
  codex: '#10a37f',
  opencode: '#f59e0b',
  gemini: '#4c8df6',
  aider: '#22a06b',
  amp: '#f34e3f',
  goose: '#a3a3a3',
  crush: '#ec4899',
  qwen: '#6d5dfc',
  'cursor-agent': '#7c7c7c',
  copilot: '#8957e5',
  droid: '#ff7a1a',
  kiro: '#7c3aed'
};

export const AGENT_MONOGRAMS: Record<CodingAgentKind, string> = {
  claude: 'C',
  codex: 'Cx',
  opencode: 'O',
  gemini: 'G',
  aider: 'Ai',
  amp: 'A',
  goose: 'Gs',
  crush: 'Cr',
  qwen: 'Q',
  'cursor-agent': 'Cu',
  copilot: 'Cp',
  droid: 'D',
  kiro: 'K'
};

export const HIGH_CPU = 25;
export const HIGH_MEMORY_KB = 1024 * 1024;
const HIGH_TRAFFIC_BPS = 100 * 1024;

export function applyUserRules(processes: ProcessInfo[], rules: UserRules): ProcessInfo[] {
  if (rules.preset === 'balanced' && !rules.keep.length && !rules.flag.length) {
    return processes;
  }
  const keep = new Set(rules.keep);
  const flag = new Set(rules.flag);

  return processes.map((process) => {
    const signature = processRuleSignature(process);
    if (keep.has(signature)) {
      return { ...process, cleanCandidate: false, riskLevel: 'low', evidence: [...process.evidence, 'Your rule: always keep'] };
    }
    if (flag.has(signature)) {
      return { ...process, riskLevel: 'high', evidence: [...process.evidence, 'Your rule: always flag'] };
    }
    const presetRisk = riskForPreset(process, rules.preset);
    return presetRisk && presetRisk !== process.riskLevel ? { ...process, riskLevel: presetRisk, evidence: [...process.evidence, `Profile: ${rules.preset}`] } : process;
  });
}

function riskForPreset(process: ProcessInfo, preset: UserRulePreset): ProcessInfo['riskLevel'] | null {
  if (preset === 'strict' && process.category === 'unknown' && (process.ports.length || process.networkConnections.length)) {
    return 'high';
  }
  if (preset === 'focus' && (process.cleanCandidate || process.cpuPercent >= 15 || trafficBps(process) >= HIGH_TRAFFIC_BPS)) {
    return process.riskLevel === 'high' ? 'high' : 'medium';
  }
  if (preset === 'deep-dev' && ['local-server', 'database', 'ai-agent'].includes(process.category)) {
    return 'low';
  }
  return null;
}

export function processRuleSignature(process: ProcessInfo): string {
  return [process.name, process.provenance.executableName, process.category, process.serviceGroup.label].join('|').toLowerCase();
}

export function ruleStateFor(process: ProcessInfo, rules: UserRules): 'keep' | 'flag' | 'none' {
  const signature = processRuleSignature(process);
  return rules.keep.includes(signature) ? 'keep' : rules.flag.includes(signature) ? 'flag' : 'none';
}

export function trafficBps(process: ProcessInfo): number {
  return (process.network.downloadBps ?? 0) + (process.network.uploadBps ?? 0);
}

export function isOrphaned(process: ProcessInfo): boolean {
  return process.tags.includes('orphaned');
}

export function isNetworkVisible(process: ProcessInfo): boolean {
  return process.ports.some((port) => port.address === '*' || port.address === '0.0.0.0' || port.address === '::');
}

export function matchesFilters(process: ProcessInfo, filters: ProcessFilters, currentUser: string): boolean {
  if (filters.scope === 'mine' && process.user !== currentUser) return false;
  if (filters.scope === 'system' && process.category !== 'macos-system') return false;
  if (filters.category !== 'all' && process.category !== filters.category) return false;

  switch (filters.activity) {
    case 'review':
      return process.riskLevel === 'medium' || process.riskLevel === 'high';
    case 'internet':
      return process.networkConnections.length > 0;
    case 'listening':
      return process.ports.length > 0;
    case 'orphaned':
      return isOrphaned(process);
    case 'high-cpu':
      return process.cpuPercent >= HIGH_CPU;
    case 'high-memory':
      return process.rssKb >= HIGH_MEMORY_KB;
    default:
      return true;
  }
}

export function countActiveFilters(filters: ProcessFilters): number {
  return Number(filters.category !== 'all') + Number(filters.activity !== 'all');
}

export function compareProcesses(a: ProcessInfo, b: ProcessInfo, sort: SortState): number {
  const direction = sort.direction === 'asc' ? 1 : -1;
  const value = (process: ProcessInfo): number | string => {
    switch (sort.key) {
      case 'name':
        return process.name.toLowerCase();
      case 'user':
        return process.user;
      case 'category':
        return CATEGORY_LABELS[process.category];
      case 'ports':
        return process.ports[0]?.port ?? (sort.direction === 'asc' ? Number.MAX_SAFE_INTEGER : -1);
      case 'connections':
        return process.networkConnections.length;
      case 'network':
        return trafficBps(process);
      default:
        return process[sort.key];
    }
  };
  const left = value(a);
  const right = value(b);
  const result = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : (left as number) - (right as number);
  return result * direction || a.pid - b.pid;
}

export function buildSearchText(process: ProcessInfo): string {
  return [
    process.name,
    process.command,
    process.description,
    process.provenance.appBundle ?? '',
    process.provenance.projectPath ?? '',
    process.serviceGroup.label,
    process.user,
    process.pid,
    process.tty ?? '',
    process.ports.map((port) => port.port).join(' '),
    process.networkConnections.map((connection) => `${connection.remoteAddress} ${connection.service}`).join(' ')
  ]
    .join(' ')
    .toLowerCase();
}

export interface TreeRow {
  process: ProcessInfo;
  depth: number;
  hasChildren: boolean;
  descendantCount: number;
}

/** Flattens the process forest in display order, sorting siblings with the active sort. */
export function flattenProcessTree(processes: ProcessInfo[], sort: SortState, collapsed: Set<number>): TreeRow[] {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const children = new Map<number, ProcessInfo[]>();
  const roots: ProcessInfo[] = [];
  for (const process of processes) {
    if (process.ppid !== process.pid && byPid.has(process.ppid)) {
      const list = children.get(process.ppid) ?? [];
      list.push(process);
      children.set(process.ppid, list);
    } else {
      roots.push(process);
    }
  }

  const countCache = new Map<number, number>();
  const countDescendants = (pid: number, guard = new Set<number>()): number => {
    const cached = countCache.get(pid);
    if (cached !== undefined) return cached;
    if (guard.has(pid)) return 0;
    guard.add(pid);
    const total = (children.get(pid) ?? []).reduce((sum, child) => sum + 1 + countDescendants(child.pid, guard), 0);
    countCache.set(pid, total);
    return total;
  };

  const rows: TreeRow[] = [];
  const visit = (process: ProcessInfo, depth: number, seen: Set<number>): void => {
    if (seen.has(process.pid)) return;
    seen.add(process.pid);
    const kids = children.get(process.pid) ?? [];
    rows.push({ process, depth, hasChildren: kids.length > 0, descendantCount: countDescendants(process.pid) });
    if (!collapsed.has(process.pid)) {
      [...kids].sort((a, b) => compareProcesses(a, b, sort)).forEach((child) => visit(child, depth + 1, seen));
    }
  };
  const seen = new Set<number>();
  [...roots].sort((a, b) => compareProcesses(a, b, sort)).forEach((root) => visit(root, 0, seen));
  return rows;
}

export function localUrl(process: ProcessInfo, port = process.ports[0]): string | null {
  if (!port) return null;
  const host = port.address === '*' || port.address === '0.0.0.0' || port.address === '::' ? 'localhost' : port.address.includes(':') ? `[${port.address}]` : port.address;
  return `http://${host}:${port.port}`;
}

export function portsText(process: ProcessInfo): string {
  const ports = process.ports.map((port) => port.port);
  return ports.length > 3 ? `${ports.slice(0, 3).join(', ')} +${ports.length - 3}` : ports.join(', ');
}

export function remoteSummary(process: ProcessInfo): string {
  const destinations = [...new Set(process.networkConnections.map((connection) => `${connection.remoteAddress}:${connection.remotePort}`))];
  return destinations.length > 2 ? `${destinations.slice(0, 2).join(', ')} +${destinations.length - 2}` : destinations.join(', ');
}

export function cleanupReason(process: ProcessInfo): string {
  if (isOrphaned(process)) {
    return `Orphaned ${process.category === 'ai-agent' ? 'MCP server' : 'process'}: its parent exited`;
  }
  if (process.category === 'local-server' && process.ports.length) {
    return `Dev server still listening on ${portsText(process)}`;
  }
  if (process.evidence.some((item) => item.startsWith('Busy in the background'))) {
    return 'Busy in the background for over 30 minutes';
  }
  return process.description;
}

export function reviewReason(process: ProcessInfo): string {
  if (process.category === 'unknown' && process.networkConnections.length) return `Unknown process talking to ${remoteSummary(process)}`;
  if (process.category === 'unknown' && process.ports.length) return `Unknown process listening on ${portsText(process)}`;
  if (process.cleanCandidate) return cleanupReason(process);
  if (isNetworkVisible(process)) return `Reachable from your network on ${portsText(process)}`;
  if (process.cpuPercent >= HIGH_CPU) return `Using ${Math.round(process.cpuPercent)}% CPU`;
  if (process.networkConnections.length) return pluralize(process.networkConnections.length, 'internet connection');
  return process.description;
}

export type FindingTone = 'critical' | 'warning' | 'info' | 'good';

export interface Finding {
  id: string;
  tone: FindingTone;
  title: string;
  detail: string;
  action: { label: string; view: ViewId; filters?: Partial<ProcessFilters>; pid?: number };
}

export function buildFindings(snapshot: ProcessSnapshot, processes: ProcessInfo[]): Finding[] {
  const findings: Finding[] = [];
  const sessions = new Map(snapshot.agents.map((session) => [session.id, session]));
  const { system } = snapshot;

  const unknownListeners = processes.filter((process) => process.category === 'unknown' && process.ports.length);
  if (unknownListeners.length) {
    findings.push({
      id: 'unknown-listeners',
      tone: 'warning',
      title: `${pluralize(unknownListeners.length, 'unknown process', 'unknown processes')} listening`,
      detail: unknownListeners
        .slice(0, 3)
        .map((process) => `${process.name} :${portsText(process)}`)
        .join(' · '),
      action: { label: 'Review', view: 'services', filters: { category: 'unknown' } }
    });
  }

  const exposed = processes.filter((process) => isNetworkVisible(process) && process.user === snapshot.currentUser && process.category !== 'macos-system');
  if (exposed.length) {
    findings.push({
      id: 'network-visible',
      tone: 'info',
      title: `${pluralize(exposed.length, 'service')} reachable from your network`,
      detail: exposed
        .slice(0, 3)
        .map((process) => `${process.name} :${portsText(process)}`)
        .join(' · '),
      action: { label: 'Show', view: 'services' }
    });
  }

  const orphans = processes.filter((process) => process.cleanCandidate && isOrphaned(process));
  if (orphans.length) {
    const memory = orphans.reduce((total, process) => total + process.rssKb * 1024, 0);
    findings.push({
      id: 'orphans',
      tone: 'warning',
      title: `${pluralize(orphans.length, 'orphaned process', 'orphaned processes')} left behind`,
      detail: `Parents exited but these kept running, holding ${formatBytes(memory)}.`,
      action: { label: 'Clean up', view: 'cleanup' }
    });
  }

  if (system.memoryPressure === 'warning' || system.memoryPressure === 'critical') {
    findings.push({
      id: 'memory-pressure',
      tone: system.memoryPressure === 'critical' ? 'critical' : 'warning',
      title: `Memory pressure is ${system.memoryPressure}`,
      detail: `${formatBytes(system.memoryUsedBytes)} used, ${formatBytes(system.swapUsedBytes)} swapped. Largest: ${[...processes]
        .sort((a, b) => b.rssKb - a.rssKb)
        .slice(0, 2)
        .map((process) => process.name)
        .join(', ')}.`,
      action: { label: 'Sort by memory', view: 'processes' }
    });
  }

  const hog = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent)[0];
  if (hog && hog.cpuPercent >= 80) {
    findings.push({
      id: `hog-${hog.pid}`,
      tone: hog.cpuPercent >= 200 ? 'warning' : 'info',
      title: `${hog.name} is using ${Math.round(hog.cpuPercent)}% CPU`,
      detail: hog.agentSessionId && sessions.get(hog.agentSessionId)
        ? `Started by ${sessions.get(hog.agentSessionId)?.label} in ${sessions.get(hog.agentSessionId)?.title ?? sessions.get(hog.agentSessionId)?.projectName}.`
        : hog.description,
      action: { label: 'Inspect', view: hog.agentSessionId ? 'agents' : 'processes', pid: hog.pid }
    });
  }

  const unknownInternet = processes.filter((process) => process.category === 'unknown' && process.networkConnections.length);
  if (unknownInternet.length) {
    findings.push({
      id: 'unknown-internet',
      tone: 'critical',
      title: `${pluralize(unknownInternet.length, 'unknown process', 'unknown processes')} on the internet`,
      detail: unknownInternet
        .slice(0, 2)
        .map((process) => `${process.name} → ${remoteSummary(process)}`)
        .join(' · '),
      action: { label: 'Review', view: 'network', filters: { category: 'unknown' } }
    });
  }

  const order: Record<FindingTone, number> = { critical: 0, warning: 1, info: 2, good: 3 };
  return findings.sort((a, b) => order[a.tone] - order[b.tone]);
}

export interface AgentTotals {
  working: number;
  waiting: number;
  cpuPercent: number;
  memoryBytes: number;
  totalTokens: number;
  outputTokens: number;
  hasUsage: boolean;
}

export function agentTotals(agents: AgentSession[]): AgentTotals {
  return agents.reduce<AgentTotals>(
    (totals, session) => ({
      working: totals.working + Number(session.status === 'working'),
      waiting: totals.waiting + Number(session.status === 'waiting'),
      cpuPercent: totals.cpuPercent + session.cpuPercent,
      memoryBytes: totals.memoryBytes + session.memoryBytes,
      totalTokens: totals.totalTokens + (session.usage?.totalTokens ?? 0),
      outputTokens: totals.outputTokens + (session.usage?.outputTokens ?? 0),
      hasUsage: totals.hasUsage || Boolean(session.usage)
    }),
    { working: 0, waiting: 0, cpuPercent: 0, memoryBytes: 0, totalTokens: 0, outputTokens: 0, hasUsage: false }
  );
}

export function agentResumeCommand(session: AgentSession): string | null {
  if (!session.resumeId) return null;
  const cd = session.cwd ? `cd ${shellQuote(session.cwd)} && ` : '';
  if (session.kind === 'claude') return `${cd}claude --resume ${session.resumeId}`;
  if (session.kind === 'codex') return `${cd}codex resume ${session.resumeId}`;
  return null;
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function networkLabel(process: ProcessInfo): string {
  if (process.network.status !== 'available') {
    return process.networkConnections.length ? formatRate(null, process.network.status) : '-';
  }
  const total = trafficBps(process);
  return total ? formatRate(total) : '-';
}
