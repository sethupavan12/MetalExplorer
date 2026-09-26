export type ProcessCategory =
  | 'macos-system'
  | 'local-server'
  | 'ai-agent'
  | 'developer-tool'
  | 'database'
  | 'browser'
  | 'user-app'
  | 'unknown';

export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export type ThemeName = 'system' | 'light' | 'dark' | 'matrix';
export type ClassificationConfidence = 'high' | 'medium' | 'low';
export type NetworkRemoteScope = 'public-internet' | 'private-network' | 'loopback' | 'link-local' | 'unknown';

export interface ListeningPort {
  address: string;
  port: number;
  protocol: 'tcp';
}

export interface NetworkConnection {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  protocol: 'tcp';
  state: 'ESTABLISHED';
  direction: 'outbound';
  remoteScope: NetworkRemoteScope;
  service: string;
  encryptedLikely: boolean;
}

export interface NetworkUsage {
  downloadBps: number | null;
  uploadBps: number | null;
  downloadedBytes: number | null;
  uploadedBytes: number | null;
  status: 'available' | 'measuring' | 'unavailable';
  connectionCount: number;
}

export interface RawProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  /** CPU usage over the last sampling interval, in percent of one core (Activity Monitor semantics). */
  cpuPercent: number;
  memoryPercent: number;
  rssKb: number;
  vszKb: number;
  elapsed: string;
  state: string;
  /** Controlling terminal, for example `ttys004`, or null for background processes. */
  tty: string | null;
  /** Cumulative CPU time consumed by the process since launch. */
  cpuTimeSeconds: number;
  /** Absolute executable path when known (from `ps -o comm`). */
  executable: string | null;
  command: string;
  name: string;
  uptimeSeconds: number;
}

export interface ProcessProvenance {
  executablePath: string;
  executableName: string;
  appBundle: string | null;
  parentPid: number;
  parentName: string | null;
  launchMethod: string;
  projectPath: string | null;
  commandPreview: string;
}

export interface ServiceGroup {
  id: string;
  label: string;
  kind: 'project' | 'runtime' | 'system' | 'app';
  detail: string;
}

export interface ProcessInfo extends RawProcessInfo {
  ports: ListeningPort[];
  networkConnections: NetworkConnection[];
  network: NetworkUsage;
  category: ProcessCategory;
  description: string;
  tags: string[];
  confidence: ClassificationConfidence;
  evidence: string[];
  provenance: ProcessProvenance;
  serviceGroup: ServiceGroup;
  safeToTerminate: boolean;
  cleanCandidate: boolean;
  impactScore: number;
  riskLevel: RiskLevel;
  /** Id of the coding agent session this process belongs to, if any. */
  agentSessionId: string | null;
}

export interface ProcessSummary {
  totalProcesses: number;
  userProcesses: number;
  macosSystem: number;
  localServers: number;
  aiAgents: number;
  databases: number;
  listeningPorts: number;
  cleanCandidates: number;
  highCpu: number;
  highMemory: number;
  unknownNetworkListeners: number;
  internetProcesses: number;
  externalConnections: number;
  networkDownloadBps: number | null;
  networkUploadBps: number | null;
  cleanableMemoryMb: number;
  cleanableCpuPercent: number;
  cpuTotal: number;
  memoryTotalMb: number;
}

export interface SystemSample {
  t: number;
  cpu: number;
  memory: number;
  down: number;
  up: number;
}

export type MemoryPressure = 'normal' | 'warning' | 'critical' | 'unknown';

export interface SystemStats {
  cpuCores: number;
  /** Share of total CPU capacity in use, 0-100. */
  cpuUsagePercent: number;
  loadAverage: [number, number, number];
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryWiredBytes: number;
  memoryCompressedBytes: number;
  swapUsedBytes: number;
  memoryPressure: MemoryPressure;
  networkDownloadBps: number;
  networkUploadBps: number;
  history: SystemSample[];
}

export type CodingAgentKind =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'gemini'
  | 'aider'
  | 'amp'
  | 'goose'
  | 'crush'
  | 'qwen'
  | 'cursor-agent'
  | 'copilot'
  | 'droid'
  | 'kiro';

/** `waiting` means the agent finished its turn and is waiting for the user. */
export type AgentSessionStatus = 'working' | 'waiting' | 'idle';

export interface AgentHost {
  /** Terminal or editor hosting the session, for example `WezTerm` or `iTerm2`. */
  name: string;
  pid: number | null;
  /** `.app` bundle path used to bring the terminal forward. */
  appPath: string | null;
}

export interface AgentChildProcess {
  pid: number;
  name: string;
  cpuPercent: number;
  rssKb: number;
  commandPreview: string;
  depth: number;
}

export interface AgentUsage {
  source: 'claude-transcript' | 'codex-rollout';
  sessionId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** Tokens in the most recent turn's prompt, a proxy for the current context size. */
  contextTokens: number | null;
  contextWindow: number | null;
  turns: number;
  lastActivityAt: string | null;
  gitBranch: string | null;
}

export interface AgentSession {
  id: string;
  kind: CodingAgentKind;
  label: string;
  /** Session title reported by the agent itself, when it exposes one. */
  title: string | null;
  rootPid: number;
  tty: string | null;
  cwd: string | null;
  projectName: string;
  host: AgentHost | null;
  multiplexer: string | null;
  uptimeSeconds: number;
  status: AgentSessionStatus;
  statusSource: 'agent' | 'activity';
  cpuPercent: number;
  memoryBytes: number;
  /** CPU time of the whole session tree, including descendants that already exited. */
  cpuTimeSeconds: number;
  processCount: number;
  cpuHistory: number[];
  memoryHistory: number[];
  ports: ListeningPort[];
  connectionCount: number;
  downloadBps: number;
  uploadBps: number;
  children: AgentChildProcess[];
  commandPreview: string;
  resumeId: string | null;
  usage: AgentUsage | null;
  safeToTerminate: boolean;
}

export interface ProcessSnapshot {
  generatedAt: string;
  currentUser: string;
  sampleIntervalMs: number;
  processes: ProcessInfo[];
  summary: ProcessSummary;
  system: SystemStats;
  agents: AgentSession[];
}

export interface ProcessHistory {
  pid: number;
  samples: Array<{ t: number; cpu: number; rssKb: number }>;
}

export interface AppSettings {
  baseUrl: string;
  model: string;
  refreshMs: number;
  rememberApiKey: boolean;
  theme: ThemeName;
  agentUsage: boolean;
  menuBarMonitor: boolean;
  hasApiKey: boolean;
  encryptionAvailable: boolean;
}

export interface SettingsUpdate {
  baseUrl?: string;
  model?: string;
  refreshMs?: number;
  rememberApiKey?: boolean;
  theme?: ThemeName;
  agentUsage?: boolean;
  menuBarMonitor?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AiExplanation {
  summary: string;
  activity: string;
  resourceReason: string;
  safeToQuit: string;
  riskLevel: RiskLevel;
  recommendedAction: string;
}

export interface TerminateResult {
  ok: boolean;
  pid: number;
  message: string;
}

export interface DiagnosticsExportResult {
  ok: boolean;
  message: string;
  path?: string;
}

export type MenuCommand =
  | { type: 'navigate'; view: string }
  | { type: 'find' }
  | { type: 'refresh' }
  | { type: 'command-palette' }
  | { type: 'toggle-inspector' }
  | { type: 'toggle-sidebar' }
  | { type: 'stop-selected' }
  | { type: 'focus-agent'; sessionId: string };

export interface MetalExplorerApi {
  /** True when the window uses native macOS vibrancy behind the sidebar. */
  vibrancy: boolean;
  listProcesses: () => Promise<ProcessSnapshot>;
  getProcessHistory: (pid: number) => Promise<ProcessHistory>;
  terminateProcesses: (pids: number[]) => Promise<TerminateResult[]>;
  openExternal: (url: string) => Promise<void>;
  revealAgentFolder: (sessionId: string) => Promise<boolean>;
  focusAgentHost: (sessionId: string) => Promise<boolean>;
  copyText: (text: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (update: SettingsUpdate) => Promise<AppSettings>;
  explainProcess: (pid: number) => Promise<AiExplanation>;
  exportDiagnostics: (pid: number) => Promise<DiagnosticsExportResult>;
  onMenuCommand: (listener: (command: MenuCommand) => void) => () => void;
}
