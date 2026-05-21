import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';
import type {
  ListeningPort,
  NetworkConnection,
  NetworkUsage,
  ProcessCategory,
  ProcessInfo,
  ProcessProvenance,
  ServiceGroup,
  ProcessSnapshot,
  ProcessSummary,
  RawProcessInfo,
  TerminateResult
} from '../shared/types';

const execFileAsync = promisify(execFile);

const PS_ARGS = ['-axo', 'pid=,ppid=,user=,pcpu=,pmem=,rss=,vsz=,etime=,state=,args='];
const NETTOP_ARGS = ['-P', '-L', '1', '-x', '-J', 'bytes_in,bytes_out', '-n'];
const DEV_SERVER_HINTS = [
  'vite',
  'next',
  'nuxt',
  'astro',
  'webpack',
  'svelte-kit',
  'tsx',
  'nodemon',
  'turbo',
  'storybook'
];
const PACKAGE_TOOL_HINTS = ['npm', 'pnpm', 'yarn', 'bun', 'node', 'deno'];
const AI_AGENT_HINTS = ['mcp', 'claude', 'codex', 'openai', 'ollama', 'lm studio', 'cursor', 'aider'];
const DATABASE_HINTS = ['mongod', 'postgres', 'redis-server', 'mysqld', 'mysql', 'qdrant', 'chroma'];
const BROWSER_HINTS = ['chrome', 'safari', 'firefox', 'arc', 'brave', 'edge'];
const SYSTEM_NAMES = new Set([
  'kernel_task',
  'launchd',
  'logd',
  'fseventsd',
  'WindowServer',
  'powerd',
  'configd',
  'systemstats',
  'UserEventAgent'
]);

interface Classification {
  category: ProcessCategory;
  description: string;
  tags: string[];
  confidence: ProcessInfo['confidence'];
  evidence: string[];
  safeToTerminate: boolean;
  cleanCandidate: boolean;
  riskLevel: ProcessInfo['riskLevel'];
}

interface NetworkByteSample {
  downloadedBytes: number;
  uploadedBytes: number;
}

interface StoredNetworkByteSample extends NetworkByteSample {
  sampledAtMs: number;
}

const previousNetworkSamples = new Map<number, StoredNetworkByteSample>();

export function parseElapsedToSeconds(value: string): number {
  const [dayPart, timePart] = value.includes('-') ? value.split('-', 2) : ['0', value];
  const days = Number.parseInt(dayPart, 10) || 0;
  const parts = timePart.split(':').map((part) => Number.parseInt(part, 10) || 0);

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return days * 86400 + minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }

  return days * 86400;
}

export function parsePsOutput(output: string): RawProcessInfo[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/
      );

      if (!match) {
        return null;
      }

      const [, pid, ppid, user, cpuPercent, memoryPercent, rssKb, vszKb, elapsed, state, command] = match;

      return {
        pid: Number.parseInt(pid, 10),
        ppid: Number.parseInt(ppid, 10),
        user,
        cpuPercent: Number.parseFloat(cpuPercent),
        memoryPercent: Number.parseFloat(memoryPercent),
        rssKb: Number.parseInt(rssKb, 10),
        vszKb: Number.parseInt(vszKb, 10),
        elapsed,
        state,
        command,
        name: extractProcessName(command),
        uptimeSeconds: parseElapsedToSeconds(elapsed)
      };
    })
    .filter((process): process is RawProcessInfo => process !== null);
}

export function parseLsofOutput(output: string): Map<number, ListeningPort[]> {
  const byPid = new Map<number, Map<number, ListeningPort>>();

  for (const line of output.split('\n')) {
    if (!line.trim() || line.startsWith('COMMAND')) {
      continue;
    }

    const columns = line.trim().split(/\s+/);
    const pid = Number.parseInt(columns[1] ?? '', 10);
    const endpoint = line.match(/\sTCP\s+(.+):(\d+)\s+\(LISTEN\)$/);

    if (!Number.isFinite(pid) || !endpoint) {
      continue;
    }

    const address = endpoint[1].replace(/^\[/, '').replace(/\]$/, '');
    const port = Number.parseInt(endpoint[2], 10);
    const ports = byPid.get(pid) ?? new Map<number, ListeningPort>();
    ports.set(port, { address, port, protocol: 'tcp' });
    byPid.set(pid, ports);
  }

  return new Map([...byPid.entries()].map(([pid, ports]) => [pid, [...ports.values()].sort((a, b) => a.port - b.port)]));
}

export function parseEstablishedLsofOutput(output: string): Map<number, NetworkConnection[]> {
  const byPid = new Map<number, Map<string, NetworkConnection>>();

  for (const line of output.split('\n')) {
    if (!line.trim() || line.startsWith('COMMAND')) {
      continue;
    }

    const columns = line.trim().split(/\s+/);
    const pid = Number.parseInt(columns[1] ?? '', 10);
    const connectionMatch = line.match(/\sTCP\s+(.+?)\s+\(ESTABLISHED\)$/);

    if (!Number.isFinite(pid) || !connectionMatch?.[1]) {
      continue;
    }

    const [localValue, remoteValue] = connectionMatch[1].split('->', 2);
    const local = parseTcpEndpoint(localValue);
    const remote = parseTcpEndpoint(remoteValue);

    if (!local || !remote || !isInternetAddress(remote.address)) {
      continue;
    }

    const key = `${local.address}:${local.port}->${remote.address}:${remote.port}`;
    const connections = byPid.get(pid) ?? new Map<string, NetworkConnection>();
    connections.set(key, {
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      protocol: 'tcp',
      state: 'ESTABLISHED',
      direction: 'outbound',
      remoteScope: classifyRemoteScope(remote.address),
      service: networkServiceLabel(remote.port),
      encryptedLikely: isLikelyEncryptedPort(remote.port)
    });
    byPid.set(pid, connections);
  }

  return new Map([...byPid.entries()].map(([pid, connections]) => [pid, [...connections.values()]]));
}

export function parseNettopOutput(output: string): Map<number, NetworkByteSample> {
  const samples = new Map<number, NetworkByteSample>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(',')) {
      continue;
    }

    const [processName, bytesIn, bytesOut] = trimmed.split(',');
    const lastDot = processName.lastIndexOf('.');
    const pid = Number.parseInt(processName.slice(lastDot + 1), 10);
    const downloadedBytes = Number.parseInt(bytesIn ?? '', 10);
    const uploadedBytes = Number.parseInt(bytesOut ?? '', 10);

    if (!Number.isFinite(pid) || !Number.isFinite(downloadedBytes) || !Number.isFinite(uploadedBytes)) {
      continue;
    }

    samples.set(pid, { downloadedBytes, uploadedBytes });
  }

  return samples;
}

export function classifyProcess(process: RawProcessInfo & { ports: ListeningPort[] }): Classification {
  const command = process.command.toLowerCase();
  const name = process.name.toLowerCase();
  const isListening = process.ports.length > 0;
  const databaseHint = findMatchingHint(DATABASE_HINTS, name, command);
  const aiAgentHint = findMatchingHint(AI_AGENT_HINTS, name, command);
  const packageToolHint = findMatchingHint(PACKAGE_TOOL_HINTS, name, command);
  const devServerHint = findMatchingHint(DEV_SERVER_HINTS, name, command);
  const browserHint = findMatchingHint(BROWSER_HINTS, name, command);
  const isSystem =
    process.user === 'root' ||
    process.command.startsWith('/System/') ||
    process.command.startsWith('/usr/libexec/') ||
    process.command.startsWith('/usr/sbin/') ||
    SYSTEM_NAMES.has(process.name);

  if (isSystem) {
    return {
      category: 'macos-system',
      description: 'macOS system service that supports core operating system behavior.',
      tags: ['system'],
      confidence: 'high',
      evidence: [process.user === 'root' ? 'Owned by root' : 'Launched from a protected macOS path'],
      safeToTerminate: false,
      cleanCandidate: false,
      riskLevel: 'low'
    };
  }

  if (databaseHint) {
    return {
      category: 'database',
      description: 'Local database or stateful storage service.',
      tags: ['database', ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Matched database hint "${databaseHint}"`, ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: 'medium'
    };
  }

  if (aiAgentHint) {
    return {
      category: 'ai-agent',
      description: 'MCP or AI agent helper process coordinating tool calls or local automation.',
      tags: ['ai', 'agent', ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Matched AI/agent hint "${aiAgentHint}"`, ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: true,
      riskLevel: isListening ? 'medium' : 'low'
    };
  }

  if (
    isListening &&
    (packageToolHint || devServerHint)
  ) {
    return {
      category: 'local-server',
      description: 'Node.js development process exposing a local web service.',
      tags: ['dev-server', 'node', 'port-listener'],
      confidence: devServerHint ? 'high' : 'medium',
      evidence: [
        devServerHint ? `Matched dev server hint "${devServerHint}"` : `Matched package tool hint "${packageToolHint}"`,
        ...listeningEvidence(process.ports)
      ],
      safeToTerminate: true,
      cleanCandidate: true,
      riskLevel: 'low'
    };
  }

  if (packageToolHint) {
    return {
      category: 'developer-tool',
      description: 'Developer tool or package process running in the background.',
      tags: ['developer-tool'],
      confidence: 'medium',
      evidence: [
        `Matched package tool hint "${packageToolHint}"`,
        process.uptimeSeconds > 1800 ? 'Running for more than 30 minutes' : 'Short-lived developer process'
      ],
      safeToTerminate: true,
      cleanCandidate: process.cpuPercent > 1 || process.uptimeSeconds > 1800,
      riskLevel: 'low'
    };
  }

  if (browserHint) {
    return {
      category: 'browser',
      description: 'Browser or browser helper process.',
      tags: ['browser'],
      confidence: 'high',
      evidence: [`Matched browser hint "${browserHint}"`],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: 'low'
    };
  }

  if (isListening) {
    return {
      category: 'unknown',
      description: 'Unknown user process exposing a local network port.',
      tags: ['unknown', 'port-listener'],
      confidence: 'low',
      evidence: ['No known app or developer-tool rule matched', ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: 'medium'
    };
  }

  return {
    category: 'user-app',
    description: 'User-owned application or background helper.',
    tags: ['user-process'],
    confidence: 'low',
    evidence: ['No specific process rule matched'],
    safeToTerminate: true,
    cleanCandidate: false,
    riskLevel: 'unknown'
  };
}

export function buildProcessSnapshotFromOutputs(
  psOutput: string,
  lsofOutput: string,
  establishedLsofOutput = '',
  networkByteSamples: Map<number, NetworkByteSample> = new Map(),
  currentUser = userInfo().username,
  currentPid = process.pid,
  sampledAtMs = Date.now()
): ProcessSnapshot {
  const portsByPid = parseLsofOutput(lsofOutput);
  const networkConnectionsByPid = parseEstablishedLsofOutput(establishedLsofOutput);
  const rawProcesses = parsePsOutput(psOutput);
  const rawProcessesByPid = new Map(rawProcesses.map((rawProcess) => [rawProcess.pid, rawProcess]));
  const processes = rawProcesses.map((rawProcess) => {
    const ports = portsByPid.get(rawProcess.pid) ?? [];
    const networkConnections = networkConnectionsByPid.get(rawProcess.pid) ?? [];
    const classification = classifyProcess({ ...rawProcess, ports });
    const provenance = buildProcessProvenance(rawProcess, rawProcessesByPid);
    const ownedByCurrentUser = rawProcess.user === currentUser;
    const protectedProcess =
      rawProcess.pid <= 1 ||
      rawProcess.pid === currentPid ||
      rawProcess.command.includes('MetalExplorer') ||
      rawProcess.command.includes('/Electron.app/');
    const safeToTerminate = classification.safeToTerminate && ownedByCurrentUser && !protectedProcess;
    const cleanCandidate =
      safeToTerminate &&
      classification.cleanCandidate &&
      ['local-server', 'ai-agent', 'developer-tool'].includes(classification.category);

    return {
      ...rawProcess,
      ports,
      networkConnections,
      network: buildNetworkUsage(rawProcess.pid, networkConnections, networkByteSamples, sampledAtMs),
      ...classification,
      provenance,
      serviceGroup: buildServiceGroup(rawProcess, classification.category, provenance),
      safeToTerminate,
      cleanCandidate,
      impactScore: calculateImpactScore(rawProcess.cpuPercent, rawProcess.rssKb, ports.length, classification.category)
    };
  });

  processes.sort((a, b) => b.cpuPercent - a.cpuPercent || b.rssKb - a.rssKb);

  return {
    generatedAt: new Date().toISOString(),
    currentUser,
    processes,
    summary: summarizeProcesses(processes, currentUser)
  };
}

export async function collectProcessSnapshot(): Promise<ProcessSnapshot> {
  const sampledAtMs = Date.now();
  const [psResult, lsofResult, establishedLsofResult, nettopResult] = await Promise.all([
    execFileAsync('/bin/ps', PS_ARGS, { maxBuffer: 8 * 1024 * 1024 }),
    execFileAsync('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { maxBuffer: 8 * 1024 * 1024 }).catch(() => ({
      stdout: ''
    })),
    execFileAsync('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:ESTABLISHED'], { maxBuffer: 16 * 1024 * 1024 }).catch(() => ({
      stdout: ''
    })),
    execFileAsync('/usr/bin/nettop', NETTOP_ARGS, { maxBuffer: 8 * 1024 * 1024 }).catch(() => ({
      stdout: ''
    }))
  ]);

  return buildProcessSnapshotFromOutputs(
    psResult.stdout,
    lsofResult.stdout,
    establishedLsofResult.stdout,
    parseNettopOutput(nettopResult.stdout),
    userInfo().username,
    process.pid,
    sampledAtMs
  );
}

export async function terminateProcessByPid(pid: number): Promise<TerminateResult> {
  if (!Number.isInteger(pid) || pid <= 1) {
    return { ok: false, message: 'Protected process cannot be terminated.' };
  }

  const snapshot = await collectProcessSnapshot();
  const target = snapshot.processes.find((process) => process.pid === pid);

  if (!target) {
    return { ok: false, message: `PID ${pid} is no longer running.` };
  }

  if (!target.safeToTerminate) {
    return { ok: false, message: `${target.name} is protected or not owned by ${snapshot.currentUser}.` };
  }

  try {
    process.kill(pid, 'SIGTERM');
    return { ok: true, message: `Sent SIGTERM to ${target.name} (${pid}).` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown termination error.';
    return { ok: false, message };
  }
}

function summarizeProcesses(processes: ProcessInfo[], currentUser: string): ProcessSummary {
  return {
    totalProcesses: processes.length,
    userProcesses: processes.filter((process) => process.user === currentUser).length,
    macosSystem: processes.filter((process) => process.category === 'macos-system').length,
    localServers: processes.filter((process) => process.category === 'local-server').length,
    aiAgents: processes.filter((process) => process.category === 'ai-agent').length,
    databases: processes.filter((process) => process.category === 'database').length,
    listeningPorts: processes.reduce((total, process) => total + process.ports.length, 0),
    cleanCandidates: processes.filter((process) => process.cleanCandidate).length,
    highCpu: processes.filter((process) => process.cpuPercent >= 10).length,
    highMemory: processes.filter((process) => process.rssKb >= 1024 * 1024).length,
    unknownNetworkListeners: processes.filter((process) => process.category === 'unknown' && process.ports.length > 0).length,
    internetProcesses: processes.filter((process) => process.networkConnections.length > 0).length,
    externalConnections: processes.reduce((total, process) => total + process.networkConnections.length, 0),
    networkDownloadBps: sumNullable(processes.filter((process) => process.networkConnections.length > 0).map((process) => process.network.downloadBps)),
    networkUploadBps: sumNullable(processes.filter((process) => process.networkConnections.length > 0).map((process) => process.network.uploadBps)),
    cleanableMemoryMb: Math.round(processes.filter((process) => process.cleanCandidate).reduce((total, process) => total + process.rssKb, 0) / 1024),
    cleanableCpuPercent: round(processes.filter((process) => process.cleanCandidate).reduce((total, process) => total + process.cpuPercent, 0)),
    cpuTotal: round(processes.reduce((total, process) => total + process.cpuPercent, 0)),
    memoryTotalMb: Math.round(processes.reduce((total, process) => total + process.rssKb, 0) / 1024)
  };
}

function findMatchingHint(hints: string[], name: string, command: string): string | null {
  return hints.find((hint) => name.includes(hint) || command.includes(hint)) ?? null;
}

function listeningEvidence(ports: ListeningPort[]): string[] {
  if (!ports.length) {
    return [];
  }

  const portText = ports.length > 3 ? `${ports.slice(0, 3).map((port) => port.port).join(', ')} +${ports.length - 3}` : ports.map((port) => port.port).join(', ');
  return [`Listening on TCP ${portText}`];
}

function extractProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0] ?? 'unknown';
  const cleaned = firstToken.replace(/^"|"$/g, '');
  return cleaned.split('/').filter(Boolean).at(-1) ?? cleaned;
}

function buildProcessProvenance(process: RawProcessInfo, processesByPid: Map<number, RawProcessInfo>): ProcessProvenance {
  const tokens = splitCommand(process.command);
  const executablePath = tokens[0] ?? process.name;
  const executableName = executablePath.split('/').filter(Boolean).at(-1) ?? process.name;
  const parent = processesByPid.get(process.ppid);

  return {
    executablePath,
    executableName,
    parentPid: process.ppid,
    parentName: parent?.name ?? null,
    launchMethod: detectLaunchMethod(process, parent),
    projectPath: detectProjectPath(tokens),
    commandPreview: buildCommandPreview(tokens)
  };
}

function buildServiceGroup(process: RawProcessInfo, category: ProcessCategory, provenance: ProcessProvenance): ServiceGroup {
  if (provenance.projectPath) {
    const projectName = provenance.projectPath.split('/').filter(Boolean).at(-1) ?? 'Project';
    return {
      id: `project:${provenance.projectPath}`,
      label: projectName,
      kind: 'project',
      detail: provenance.projectPath
    };
  }

  if (category === 'macos-system') {
    return {
      id: 'system:macos',
      label: 'macOS System',
      kind: 'system',
      detail: 'Protected operating system services'
    };
  }

  if (category === 'local-server' || category === 'ai-agent' || category === 'database' || category === 'developer-tool') {
    return {
      id: `runtime:${category}:${provenance.executableName}`,
      label: `${provenance.executableName} runtime`,
      kind: 'runtime',
      detail: provenance.launchMethod
    };
  }

  return {
    id: `app:${process.name}`,
    label: process.name,
    kind: 'app',
    detail: provenance.launchMethod
  };
}

function splitCommand(command: string): string[] {
  return (
    command
      .match(/"[^"]+"|'[^']+'|\S+/g)
      ?.map((token) => token.replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
      .filter(Boolean) ?? []
  );
}

function detectLaunchMethod(process: RawProcessInfo, parent?: RawProcessInfo): string {
  const command = process.command.toLowerCase();
  const name = process.name.toLowerCase();
  const parentName = parent?.name.toLowerCase();

  if (process.ppid === 1 || parentName === 'launchd') {
    return 'launchd';
  }

  if (command.includes('/electron.app/') || name.includes('electron')) {
    return 'Electron app';
  }

  if (['npm', 'pnpm', 'yarn', 'bun', 'node', 'deno'].some((tool) => name.includes(tool) || command.includes(`/${tool} `))) {
    return 'JavaScript toolchain';
  }

  if (['python', 'ruby', 'go', 'java'].some((tool) => name.includes(tool) || command.includes(`/${tool}`))) {
    return 'developer runtime';
  }

  if (parentName) {
    return `child of ${parent?.name ?? 'parent process'}`;
  }

  return 'direct process';
}

function detectProjectPath(tokens: string[]): string | null {
  const projectToken = tokens.find((token) => token.includes('/node_modules/') || token.includes('/.venv/') || token.includes('/target/') || token.includes('/dist/'));

  if (!projectToken?.startsWith('/')) {
    return null;
  }

  const markers = ['/node_modules/', '/.venv/', '/target/', '/dist/'];
  const marker = markers.find((value) => projectToken.includes(value));
  if (!marker) {
    return null;
  }

  return projectToken.slice(0, projectToken.indexOf(marker));
}

function buildCommandPreview(tokens: string[]): string {
  if (!tokens.length) {
    return 'unknown';
  }

  const preview = tokens.slice(0, 4).join(' ');
  return tokens.length > 4 ? `${preview} ...` : preview;
}

function calculateImpactScore(cpuPercent: number, rssKb: number, portCount: number, category: ProcessCategory): number {
  const memoryMb = rssKb / 1024;
  const categoryWeight = category === 'unknown' ? 18 : category === 'database' ? 10 : category === 'ai-agent' ? 8 : 0;
  return Math.min(100, Math.round(cpuPercent * 2.2 + memoryMb / 80 + portCount * 8 + categoryWeight));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildNetworkUsage(
  pid: number,
  connections: NetworkConnection[],
  samples: Map<number, NetworkByteSample>,
  sampledAtMs: number
): NetworkUsage {
  const current = samples.get(pid);

  if (!connections.length) {
    if (current) {
      previousNetworkSamples.set(pid, { ...current, sampledAtMs });
    }

    return {
      downloadBps: 0,
      uploadBps: 0,
      downloadedBytes: current?.downloadedBytes ?? null,
      uploadedBytes: current?.uploadedBytes ?? null,
      status: current ? 'available' : 'unavailable',
      connectionCount: 0
    };
  }

  if (!current) {
    return {
      downloadBps: null,
      uploadBps: null,
      downloadedBytes: null,
      uploadedBytes: null,
      status: 'unavailable',
      connectionCount: connections.length
    };
  }

  const previous = previousNetworkSamples.get(pid);
  previousNetworkSamples.set(pid, { ...current, sampledAtMs });

  if (!previous || sampledAtMs <= previous.sampledAtMs) {
    return {
      downloadBps: null,
      uploadBps: null,
      downloadedBytes: current.downloadedBytes,
      uploadedBytes: current.uploadedBytes,
      status: 'measuring',
      connectionCount: connections.length
    };
  }

  const seconds = (sampledAtMs - previous.sampledAtMs) / 1000;
  return {
    downloadBps: Math.max(0, Math.round((current.downloadedBytes - previous.downloadedBytes) / seconds)),
    uploadBps: Math.max(0, Math.round((current.uploadedBytes - previous.uploadedBytes) / seconds)),
    downloadedBytes: current.downloadedBytes,
    uploadedBytes: current.uploadedBytes,
    status: 'available',
    connectionCount: connections.length
  };
}

function parseTcpEndpoint(value?: string): { address: string; port: number } | null {
  const endpoint = value?.trim();
  if (!endpoint) {
    return null;
  }

  const bracketed = endpoint.match(/^\[([^\]]+)]:(\d+)$/);
  if (bracketed) {
    return { address: bracketed[1], port: Number.parseInt(bracketed[2], 10) };
  }

  const lastColon = endpoint.lastIndexOf(':');
  if (lastColon <= 0) {
    return null;
  }

  const address = endpoint.slice(0, lastColon).replace(/^\[/, '').replace(/]$/, '');
  const port = Number.parseInt(endpoint.slice(lastColon + 1), 10);
  return Number.isFinite(port) ? { address, port } : null;
}

function isInternetAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[/, '').replace(/]$/, '');

  if (
    normalized === '*' ||
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  ) {
    return false;
  }

  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number.parseInt(ipv4[1], 10);
    const second = Number.parseInt(ipv4[2], 10);
    return !(
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  if (normalized.includes(':')) {
    return !(normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd'));
  }

  return true;
}

function classifyRemoteScope(address: string): ProcessInfo['networkConnections'][number]['remoteScope'] {
  const normalized = address.toLowerCase().replace(/^\[/, '').replace(/]$/, '');

  if (normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.')) {
    return 'loopback';
  }

  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number.parseInt(ipv4[1], 10);
    const second = Number.parseInt(ipv4[2], 10);
    if (first === 169 && second === 254) {
      return 'link-local';
    }
    if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
      return 'private-network';
    }
    return 'public-internet';
  }

  if (normalized.includes(':')) {
    if (normalized.startsWith('fe80:')) {
      return 'link-local';
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return 'private-network';
    }
    return 'public-internet';
  }

  return 'unknown';
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

  if (port === 5432) {
    return 'PostgreSQL';
  }

  if (port === 27017) {
    return 'MongoDB';
  }

  return `TCP ${port}`;
}

function isLikelyEncryptedPort(port: number): boolean {
  return [443, 22, 993, 995, 465, 853].includes(port);
}

function sumNullable(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((total, value) => total + value, 0) : null;
}
