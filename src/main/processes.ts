import type {
  ListeningPort,
  NetworkConnection,
  NetworkUsage,
  ProcessCategory,
  ProcessInfo,
  ProcessProvenance,
  ProcessSummary,
  RawProcessInfo,
  ServiceGroup
} from '../shared/types';
import { basename, detectCodingAgent, splitArgs } from './agent-catalog';

export const PS_ARGS = ['-axo', 'pid=,ppid=,user=,pcpu=,pmem=,rss=,vsz=,etime=,time=,state=,tty=,args='];
export const PS_COMM_ARGS = ['-axo', 'pid=,comm='];
export const NETTOP_ARGS = ['-P', '-L', '1', '-x', '-J', 'bytes_in,bytes_out', '-n'];

const DEV_SERVER_HINTS = new Set([
  'vite',
  'next',
  'next-server',
  'nuxt',
  'nuxi',
  'astro',
  'webpack',
  'webpack-dev-server',
  'svelte-kit',
  'nodemon',
  'turbo',
  'storybook',
  'remix',
  'parcel',
  'wrangler',
  'uvicorn',
  'gunicorn',
  'flask',
  'rails',
  'puma',
  'hugo',
  'jekyll',
  'http-server',
  'serve',
  'expo',
  'metro'
]);
const TOOLCHAIN_NAMES = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'bunx',
  'deno',
  'tsx',
  'ts-node',
  'python',
  'python3',
  'ruby',
  'go',
  'cargo',
  'rustc',
  'rust-analyzer',
  'java',
  'gradle',
  'make',
  'esbuild',
  'tsc',
  'eslint',
  'watchman',
  'gopls',
  'pyright',
  'typescript-language-server'
]);
const DATABASE_NAMES = new Set([
  'mongod',
  'postgres',
  'postmaster',
  'redis-server',
  'valkey-server',
  'mysqld',
  'mariadbd',
  'qdrant',
  'chroma',
  'clickhouse',
  'memcached',
  'etcd',
  'meilisearch',
  'typesense-server',
  'influxd',
  'cockroach'
]);
const LOCAL_MODEL_NAMES = new Set(['ollama', 'llama-server', 'llamafile', 'lms', 'mlx_lm.server', 'vllm', 'localai']);
const BROWSER_BUNDLES = new Set([
  'google chrome',
  'google chrome helper',
  'safari',
  'firefox',
  'arc',
  'brave browser',
  'microsoft edge',
  'chromium',
  'orion',
  'zen',
  'zen browser',
  'vivaldi',
  'opera',
  'dia'
]);
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
const PROTECTED_PATH_PREFIXES = ['/System/', '/usr/libexec/', '/usr/sbin/', '/sbin/', '/Library/Apple/', '/private/var/db/', '/System/Volumes/Preboot/Cryptexes/'];
const MCP_PATTERN = /(^|[-_@/.])mcp([-_./]|$)|modelcontextprotocol/;
const ORPHAN_MIN_UPTIME_SECONDS = 10 * 60;
/** Past this gap (for example after the window was hidden), a delta is an average over the gap, not current use. */
const MAX_DELTA_INTERVAL_MS = 30_000;

export interface Classification {
  category: ProcessCategory;
  description: string;
  tags: string[];
  confidence: ProcessInfo['confidence'];
  evidence: string[];
  safeToTerminate: boolean;
  cleanCandidate: boolean;
  riskLevel: ProcessInfo['riskLevel'];
}

export interface NetworkByteSample {
  downloadedBytes: number;
  uploadedBytes: number;
}

/** Per-process counters carried between samples so rates are measured, not estimated. */
export interface SamplerState {
  cpu: Map<number, { cpuTimeSeconds: number; sampledAtMs: number; startKey: string }>;
  network: Map<number, NetworkByteSample & { sampledAtMs: number; startKey: string }>;
}

export function createSamplerState(): SamplerState {
  return { cpu: new Map(), network: new Map() };
}

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

/** Parses `ps -o time` values such as `0:01.23`, `517:12.33`, or `1-02:03:04`. */
export function parseCpuTime(value: string): number {
  const [dayPart, timePart] = value.includes('-') ? value.split('-', 2) : ['0', value];
  const days = Number.parseInt(dayPart, 10) || 0;
  const parts = timePart.split(':').map((part) => Number.parseFloat(part) || 0);
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return Math.round((days * 86400 + seconds) * 100) / 100;
}

export function parseCommOutput(output: string): Map<number, string> {
  const byPid = new Map<number, string>();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match) {
      byPid.set(Number.parseInt(match[1], 10), match[2]);
    }
  }
  return byPid;
}

export function parsePsOutput(output: string, commByPid: Map<number, string> = new Map()): RawProcessInfo[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/
      );

      if (!match) {
        return null;
      }

      const [, pid, ppid, user, cpuPercent, memoryPercent, rssKb, vszKb, elapsed, cpuTime, state, tty, command] = match;
      const pidNumber = Number.parseInt(pid, 10);
      const comm = commByPid.get(pidNumber) ?? null;
      const executable = comm?.startsWith('/') ? comm : null;

      return {
        pid: pidNumber,
        ppid: Number.parseInt(ppid, 10),
        user,
        cpuPercent: Number.parseFloat(cpuPercent),
        memoryPercent: Number.parseFloat(memoryPercent),
        rssKb: Number.parseInt(rssKb, 10),
        vszKb: Number.parseInt(vszKb, 10),
        elapsed,
        state,
        tty: tty === '??' || tty === '-' ? null : tty,
        cpuTimeSeconds: parseCpuTime(cpuTime),
        executable,
        command,
        name: extractProcessName(command, comm, executable),
        uptimeSeconds: parseElapsedToSeconds(elapsed)
      };
    })
    .filter((process): process is RawProcessInfo => process !== null);
}

export function parseLsofOutput(output: string): Map<number, ListeningPort[]> {
  const byPid = new Map<number, Map<string, ListeningPort>>();

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
    const ports = byPid.get(pid) ?? new Map<string, ListeningPort>();
    const existing = ports.get(String(port));
    // A port bound on both IPv4 and IPv6 shows twice. Keep the most exposed address so the UI never understates reach.
    if (!existing || exposureRank(address) > exposureRank(existing.address)) {
      ports.set(String(port), { address, port, protocol: 'tcp' });
    }
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
  const tokens = splitArgs(process.command);
  const executablePath = process.executable ?? tokens[0] ?? process.name;
  const executableName = basename(executablePath).toLowerCase();
  const tokenNames = commandTokenNames(tokens);
  const appBundle = detectAppBundle(executablePath);
  const isListening = process.ports.length > 0;
  const orphaned = process.ppid === 1 && !appBundle;
  const isSystem =
    process.user === 'root' ||
    process.user.startsWith('_') ||
    PROTECTED_PATH_PREFIXES.some((prefix) => executablePath.startsWith(prefix)) ||
    SYSTEM_NAMES.has(process.name);

  if (isSystem) {
    return {
      category: 'macos-system',
      description: 'macOS system service that supports core operating system behavior.',
      tags: ['system'],
      confidence: 'high',
      evidence: [
        process.user === 'root' ? 'Owned by root' : process.user.startsWith('_') ? `Owned by system account ${process.user}` : 'Launched from a protected macOS path'
      ],
      safeToTerminate: false,
      cleanCandidate: false,
      riskLevel: 'low'
    };
  }

  const codingAgent = detectCodingAgent(process);
  if (codingAgent) {
    return {
      category: 'ai-agent',
      description: `${codingAgent.label} coding agent${process.tty ? ` running in ${process.tty}` : ''}.`,
      tags: ['ai', 'coding-agent', codingAgent.kind, ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Executable identified as ${codingAgent.label}`, ...(process.tty ? [`Attached to terminal ${process.tty}`] : []), ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      // A live coding session is never a cleanup suggestion; it may hold unsaved work.
      cleanCandidate: false,
      riskLevel: 'low'
    };
  }

  const databaseHint = tokenNames.find((token) => DATABASE_NAMES.has(token));
  if (databaseHint) {
    return {
      category: 'database',
      description: 'Local database or stateful storage service.',
      tags: ['database', ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Executable matches database "${databaseHint}"`, ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: 'medium'
    };
  }

  const modelHint = tokenNames.find((token) => LOCAL_MODEL_NAMES.has(token)) ?? (appBundle?.toLowerCase() === 'lm studio' ? 'LM Studio' : null);
  if (modelHint) {
    return {
      category: 'ai-agent',
      description: 'Local model runtime serving AI inference on this Mac.',
      tags: ['ai', 'model-runtime', ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Executable matches local model runtime "${modelHint}"`, ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: isListening ? 'medium' : 'low'
    };
  }

  const mcpToken = !appBundle ? tokens.slice(0, 6).find((token) => MCP_PATTERN.test(token.toLowerCase())) : undefined;
  if (mcpToken) {
    const orphanCandidate = orphaned && process.uptimeSeconds >= ORPHAN_MIN_UPTIME_SECONDS;
    return {
      category: 'ai-agent',
      description: orphanCandidate
        ? 'MCP server left running after the agent that started it exited.'
        : 'MCP server providing tools to an AI agent.',
      tags: ['ai', 'mcp', ...(orphaned ? ['orphaned'] : []), ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Command references MCP (${basename(mcpToken)})`, ...(orphaned ? ['Parent exited; reparented to launchd'] : []), ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: orphanCandidate,
      riskLevel: isListening ? 'medium' : 'low'
    };
  }

  const devServerHint = tokenNames.find((token) => DEV_SERVER_HINTS.has(token));
  const toolchainHint = TOOLCHAIN_NAMES.has(executableName) ? executableName : tokenNames.find((token) => TOOLCHAIN_NAMES.has(token));

  if (isListening && !appBundle && (devServerHint || toolchainHint)) {
    return {
      category: 'local-server',
      description: devServerHint ? `Development server (${devServerHint}) exposing a local web service.` : 'Development process exposing a local network service.',
      tags: ['dev-server', ...(toolchainHint ? [toolchainHint] : []), 'port-listener', ...(orphaned ? ['orphaned'] : [])],
      confidence: devServerHint ? 'high' : 'medium',
      evidence: [
        devServerHint ? `Command runs dev server "${devServerHint}"` : `Runs on the ${toolchainHint} toolchain`,
        ...(orphaned ? ['Parent exited; reparented to launchd'] : []),
        ...listeningEvidence(process.ports)
      ],
      safeToTerminate: true,
      cleanCandidate: true,
      riskLevel: 'low'
    };
  }

  if (toolchainHint && !appBundle) {
    const orphanCandidate = orphaned && process.uptimeSeconds >= ORPHAN_MIN_UPTIME_SECONDS;
    const busyBackground = !process.tty && process.uptimeSeconds > 1800 && process.cpuPercent >= 5;
    return {
      category: 'developer-tool',
      description: orphanCandidate ? 'Developer process left running after its parent exited.' : 'Developer tool or build process.',
      tags: ['developer-tool', toolchainHint, ...(orphaned ? ['orphaned'] : [])],
      confidence: 'medium',
      evidence: [
        `Runs on the ${toolchainHint} toolchain`,
        ...(orphaned ? ['Parent exited; reparented to launchd'] : []),
        ...(busyBackground ? ['Busy in the background for more than 30 minutes'] : []),
        process.tty ? `Attached to terminal ${process.tty}` : 'No controlling terminal'
      ],
      safeToTerminate: true,
      cleanCandidate: orphanCandidate || busyBackground,
      riskLevel: 'low'
    };
  }

  if (appBundle && BROWSER_BUNDLES.has(appBundle.toLowerCase())) {
    return {
      category: 'browser',
      description: `${appBundle} browser process.`,
      tags: ['browser'],
      confidence: 'high',
      evidence: [`Part of ${appBundle}.app`],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: 'low'
    };
  }

  if (appBundle) {
    return {
      category: 'user-app',
      description: `Part of the ${appBundle} app.`,
      tags: ['app', ...(isListening ? ['port-listener'] : [])],
      confidence: 'high',
      evidence: [`Executable lives inside ${appBundle}.app`, ...listeningEvidence(process.ports)],
      safeToTerminate: true,
      cleanCandidate: false,
      riskLevel: isListening && process.ports.some((port) => isWildcardAddress(port.address)) ? 'medium' : 'low'
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
    description: 'User-owned command or background helper.',
    tags: ['user-process'],
    confidence: 'low',
    evidence: ['No specific process rule matched'],
    safeToTerminate: true,
    cleanCandidate: false,
    riskLevel: 'unknown'
  };
}

export interface SnapshotInputs {
  psOutput: string;
  commOutput?: string;
  lsofOutput: string;
  establishedLsofOutput?: string;
  networkSamples?: Map<number, NetworkByteSample>;
  currentUser: string;
  currentPid: number;
  sampledAtMs: number;
  state?: SamplerState;
}

export function buildProcessesFromOutputs(inputs: SnapshotInputs): { processes: ProcessInfo[]; summary: ProcessSummary } {
  const state = inputs.state ?? createSamplerState();
  const networkSamples = inputs.networkSamples ?? new Map<number, NetworkByteSample>();
  const portsByPid = parseLsofOutput(inputs.lsofOutput);
  const networkConnectionsByPid = parseEstablishedLsofOutput(inputs.establishedLsofOutput ?? '');
  const rawProcesses = parsePsOutput(inputs.psOutput, parseCommOutput(inputs.commOutput ?? ''));
  const rawProcessesByPid = new Map(rawProcesses.map((rawProcess) => [rawProcess.pid, rawProcess]));

  const processes = rawProcesses.map((sampled): ProcessInfo => {
    const startKey = processStartKey(sampled, inputs.sampledAtMs);
    const rawProcess = { ...sampled, cpuPercent: measureCpuPercent(sampled, startKey, state, inputs.sampledAtMs) };
    const ports = portsByPid.get(rawProcess.pid) ?? [];
    const networkConnections = networkConnectionsByPid.get(rawProcess.pid) ?? [];
    const classification = classifyProcess({ ...rawProcess, ports });
    const provenance = buildProcessProvenance(rawProcess, rawProcessesByPid);
    const ownedByCurrentUser = rawProcess.user === inputs.currentUser;
    const safeToTerminate = classification.safeToTerminate && ownedByCurrentUser && !isProtectedProcess(rawProcess, inputs.currentPid);
    const cleanCandidate =
      safeToTerminate &&
      classification.cleanCandidate &&
      ['local-server', 'ai-agent', 'developer-tool'].includes(classification.category);

    return {
      ...rawProcess,
      ports,
      networkConnections,
      network: measureNetworkUsage(rawProcess.pid, startKey, networkConnections.length, networkSamples.get(rawProcess.pid), state, inputs.sampledAtMs),
      ...classification,
      provenance,
      serviceGroup: buildServiceGroup(rawProcess, classification.category, provenance),
      safeToTerminate,
      cleanCandidate,
      impactScore: calculateImpactScore(rawProcess.cpuPercent, rawProcess.rssKb, ports.length, classification.category),
      agentSessionId: null
    };
  });

  pruneSamplerState(state, rawProcessesByPid);
  processes.sort((a, b) => b.cpuPercent - a.cpuPercent || b.rssKb - a.rssKb);

  return { processes, summary: summarizeProcesses(processes, inputs.currentUser) };
}

export function isProtectedProcess(process: Pick<RawProcessInfo, 'pid' | 'command'>, currentPid: number): boolean {
  return (
    process.pid <= 1 ||
    process.pid === currentPid ||
    process.command.includes('MetalExplorer') ||
    process.command.includes('/Electron.app/')
  );
}

/** Approximate launch time in epoch seconds. Together with the pid it identifies a process across samples. */
export function processStartKey(process: Pick<RawProcessInfo, 'uptimeSeconds'>, sampledAtMs: number): string {
  return String(Math.round(sampledAtMs / 1000) - process.uptimeSeconds);
}

function sameStart(a: string, b: string): boolean {
  return Math.abs(Number(a) - Number(b)) <= 2;
}

function measureCpuPercent(process: RawProcessInfo, startKey: string, state: SamplerState, sampledAtMs: number): number {
  const previous = state.cpu.get(process.pid);
  state.cpu.set(process.pid, { cpuTimeSeconds: process.cpuTimeSeconds, sampledAtMs, startKey });

  if (!previous || sampledAtMs <= previous.sampledAtMs || sampledAtMs - previous.sampledAtMs > MAX_DELTA_INTERVAL_MS || !sameStart(previous.startKey, startKey)) {
    return process.cpuPercent;
  }

  const delta = process.cpuTimeSeconds - previous.cpuTimeSeconds;
  if (delta < 0) {
    return process.cpuPercent;
  }

  return round((delta / ((sampledAtMs - previous.sampledAtMs) / 1000)) * 100);
}

function measureNetworkUsage(
  pid: number,
  startKey: string,
  connectionCount: number,
  current: NetworkByteSample | undefined,
  state: SamplerState,
  sampledAtMs: number
): NetworkUsage {
  if (!current) {
    return {
      downloadBps: connectionCount ? null : 0,
      uploadBps: connectionCount ? null : 0,
      downloadedBytes: null,
      uploadedBytes: null,
      status: 'unavailable',
      connectionCount
    };
  }

  const previous = state.network.get(pid);
  state.network.set(pid, { ...current, sampledAtMs, startKey });

  if (
    !previous ||
    sampledAtMs <= previous.sampledAtMs ||
    sampledAtMs - previous.sampledAtMs > MAX_DELTA_INTERVAL_MS ||
    !sameStart(previous.startKey, startKey) ||
    current.downloadedBytes < previous.downloadedBytes ||
    current.uploadedBytes < previous.uploadedBytes
  ) {
    return {
      downloadBps: null,
      uploadBps: null,
      downloadedBytes: current.downloadedBytes,
      uploadedBytes: current.uploadedBytes,
      status: 'measuring',
      connectionCount
    };
  }

  const seconds = (sampledAtMs - previous.sampledAtMs) / 1000;
  return {
    downloadBps: Math.max(0, Math.round((current.downloadedBytes - previous.downloadedBytes) / seconds)),
    uploadBps: Math.max(0, Math.round((current.uploadedBytes - previous.uploadedBytes) / seconds)),
    downloadedBytes: current.downloadedBytes,
    uploadedBytes: current.uploadedBytes,
    status: 'available',
    connectionCount
  };
}

function pruneSamplerState(state: SamplerState, alive: Map<number, RawProcessInfo>): void {
  for (const pid of state.cpu.keys()) {
    if (!alive.has(pid)) {
      state.cpu.delete(pid);
    }
  }
  for (const pid of state.network.keys()) {
    if (!alive.has(pid)) {
      state.network.delete(pid);
    }
  }
}

function summarizeProcesses(processes: ProcessInfo[], currentUser: string): ProcessSummary {
  let listeningPorts = 0;
  let externalConnections = 0;
  let down: number | null = null;
  let up: number | null = null;
  let cleanableKb = 0;
  let cleanableCpu = 0;
  let cpuTotal = 0;
  let memoryKb = 0;
  const summary: ProcessSummary = {
    totalProcesses: processes.length,
    userProcesses: 0,
    macosSystem: 0,
    localServers: 0,
    aiAgents: 0,
    databases: 0,
    listeningPorts: 0,
    cleanCandidates: 0,
    highCpu: 0,
    highMemory: 0,
    unknownNetworkListeners: 0,
    internetProcesses: 0,
    externalConnections: 0,
    networkDownloadBps: null,
    networkUploadBps: null,
    cleanableMemoryMb: 0,
    cleanableCpuPercent: 0,
    cpuTotal: 0,
    memoryTotalMb: 0
  };

  for (const process of processes) {
    summary.userProcesses += Number(process.user === currentUser);
    summary.macosSystem += Number(process.category === 'macos-system');
    summary.localServers += Number(process.category === 'local-server');
    summary.aiAgents += Number(process.category === 'ai-agent');
    summary.databases += Number(process.category === 'database');
    summary.highCpu += Number(process.cpuPercent >= 10);
    summary.highMemory += Number(process.rssKb >= 1024 * 1024);
    summary.unknownNetworkListeners += Number(process.category === 'unknown' && process.ports.length > 0);
    summary.internetProcesses += Number(process.networkConnections.length > 0);
    listeningPorts += process.ports.length;
    externalConnections += process.networkConnections.length;
    cpuTotal += process.cpuPercent;
    memoryKb += process.rssKb;

    if (process.network.downloadBps !== null && process.network.status === 'available') {
      down = (down ?? 0) + process.network.downloadBps;
    }
    if (process.network.uploadBps !== null && process.network.status === 'available') {
      up = (up ?? 0) + process.network.uploadBps;
    }

    if (process.cleanCandidate) {
      summary.cleanCandidates += 1;
      cleanableKb += process.rssKb;
      cleanableCpu += process.cpuPercent;
    }
  }

  return {
    ...summary,
    listeningPorts,
    externalConnections,
    networkDownloadBps: down,
    networkUploadBps: up,
    cleanableMemoryMb: Math.round(cleanableKb / 1024),
    cleanableCpuPercent: round(cleanableCpu),
    cpuTotal: round(cpuTotal),
    memoryTotalMb: Math.round(memoryKb / 1024)
  };
}

function commandTokenNames(tokens: string[]): string[] {
  return tokens
    .slice(0, 8)
    .filter((token) => !token.startsWith('-'))
    .map((token) => basename(token).toLowerCase().replace(/\.(m?js|cjs|py|rb|ts)$/, ''));
}

export function detectAppBundle(executablePath: string): string | null {
  const match = executablePath.match(/\/([^/]+)\.app\/Contents\//);
  if (!match) {
    return null;
  }

  // Helpers live in nested bundles such as `Foo.app/Contents/Frameworks/Foo Helper.app`; report the outer app.
  const outer = executablePath.match(/^.*?\/([^/]+)\.app\/Contents\//);
  return outer?.[1] ?? match[1];
}

function listeningEvidence(ports: ListeningPort[]): string[] {
  if (!ports.length) {
    return [];
  }

  const portText = ports.length > 3 ? `${ports.slice(0, 3).map((port) => port.port).join(', ')} +${ports.length - 3}` : ports.map((port) => port.port).join(', ');
  return [`Listening on TCP ${portText}`];
}

function extractProcessName(command: string, comm: string | null, executable: string | null): string {
  if (executable) {
    return basename(executable);
  }

  if (comm && !comm.includes('/')) {
    return comm;
  }

  const firstToken = command.trim().split(/\s+/)[0] ?? 'unknown';
  const cleaned = firstToken.replace(/^"|"$/g, '');
  return basename(cleaned);
}

function buildProcessProvenance(process: RawProcessInfo, processesByPid: Map<number, RawProcessInfo>): ProcessProvenance {
  const tokens = splitArgs(process.command);
  const executablePath = process.executable ?? tokens[0] ?? process.name;
  const executableName = basename(executablePath);
  const parent = processesByPid.get(process.ppid);
  const appBundle = detectAppBundle(executablePath);

  return {
    executablePath,
    executableName,
    appBundle,
    parentPid: process.ppid,
    parentName: parent?.name ?? null,
    launchMethod: detectLaunchMethod(process, executableName, appBundle, parent),
    projectPath: detectProjectPath(tokens),
    commandPreview: buildCommandPreview(tokens)
  };
}

function buildServiceGroup(process: RawProcessInfo, category: ProcessCategory, provenance: ProcessProvenance): ServiceGroup {
  if (provenance.projectPath) {
    const projectName = basename(provenance.projectPath) || 'Project';
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

  if (provenance.appBundle) {
    return {
      id: `app:${provenance.appBundle}`,
      label: provenance.appBundle,
      kind: 'app',
      detail: `${provenance.appBundle}.app`
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

function detectLaunchMethod(process: RawProcessInfo, executableName: string, appBundle: string | null, parent?: RawProcessInfo): string {
  const name = executableName.toLowerCase();

  if (process.ppid === 1 || parent?.name === 'launchd') {
    return appBundle ? 'App launched by launchd' : 'launchd (agent or orphaned)';
  }

  if (appBundle) {
    return parent ? `${appBundle} helper` : `${appBundle}.app`;
  }

  if (['npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'tsx'].includes(name)) {
    return 'JavaScript toolchain';
  }

  if (['python', 'python3', 'ruby', 'go', 'java', 'cargo'].includes(name.replace(/[\d.]+$/, ''))) {
    return 'Developer runtime';
  }

  if (process.tty) {
    return parent ? `${parent.name} in ${process.tty}` : `Terminal ${process.tty}`;
  }

  if (parent) {
    return `Child of ${parent.name}`;
  }

  return 'Direct process';
}

function detectProjectPath(tokens: string[]): string | null {
  const markers = ['/node_modules/', '/.venv/', '/target/', '/dist/'];
  for (const token of tokens) {
    if (!token.startsWith('/')) {
      continue;
    }
    const marker = markers.find((value) => token.includes(value));
    if (marker) {
      const projectPath = token.slice(0, token.indexOf(marker));
      // Global installs such as /opt/homebrew/lib/node_modules are not projects.
      if (projectPath && !/\/(lib|share)$/.test(projectPath) && !projectPath.startsWith('/usr/') && !projectPath.startsWith('/opt/')) {
        return projectPath;
      }
    }
  }

  return null;
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

export function isWildcardAddress(address: string): boolean {
  return address === '*' || address === '0.0.0.0' || address === '::';
}

function exposureRank(address: string): number {
  if (isWildcardAddress(address)) {
    return 2;
  }
  return address === '127.0.0.1' || address === '::1' || address === 'localhost' ? 0 : 1;
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

const SERVICE_LABELS: Record<number, string> = {
  22: 'SSH',
  53: 'DNS',
  80: 'HTTP',
  443: 'HTTPS',
  993: 'IMAPS',
  5222: 'XMPP',
  5223: 'APNs',
  5228: 'Google Push',
  5432: 'PostgreSQL',
  6379: 'Redis',
  27017: 'MongoDB'
};

function networkServiceLabel(port: number): string {
  return SERVICE_LABELS[port] ?? `TCP ${port}`;
}

function isLikelyEncryptedPort(port: number): boolean {
  return [443, 22, 993, 995, 465, 853, 5223].includes(port);
}
