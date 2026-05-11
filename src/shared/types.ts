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
export type ThemeName = 'light' | 'dark' | 'matrix';

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
  cpuPercent: number;
  memoryPercent: number;
  rssKb: number;
  vszKb: number;
  elapsed: string;
  state: string;
  command: string;
  name: string;
  uptimeSeconds: number;
}

export interface ProcessInfo extends RawProcessInfo {
  ports: ListeningPort[];
  networkConnections: NetworkConnection[];
  network: NetworkUsage;
  category: ProcessCategory;
  description: string;
  tags: string[];
  safeToTerminate: boolean;
  cleanCandidate: boolean;
  impactScore: number;
  riskLevel: RiskLevel;
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

export interface ProcessSnapshot {
  generatedAt: string;
  currentUser: string;
  processes: ProcessInfo[];
  summary: ProcessSummary;
}

export interface AppSettings {
  baseUrl: string;
  model: string;
  refreshMs: number;
  rememberApiKey: boolean;
  theme: ThemeName;
  hasApiKey: boolean;
  encryptionAvailable: boolean;
}

export interface SettingsUpdate {
  baseUrl?: string;
  model?: string;
  refreshMs?: number;
  rememberApiKey?: boolean;
  theme?: ThemeName;
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
  message: string;
}

export interface MetalExplorerApi {
  listProcesses: () => Promise<ProcessSnapshot>;
  terminateProcess: (pid: number) => Promise<TerminateResult>;
  openExternal: (url: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (update: SettingsUpdate) => Promise<AppSettings>;
  explainProcess: (process: ProcessInfo) => Promise<AiExplanation>;
}
