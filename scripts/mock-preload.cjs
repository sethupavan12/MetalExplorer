// Deterministic fake data for visual smoke tests. Mirrors the shape of the real preload API.
const { contextBridge } = require('electron');

const USER = 'demo';
const NOW = Date.UTC(2026, 8, 26, 10, 30, 0);

function wave(length, base, amplitude, seed, floor = 0) {
  return Array.from({ length }, (_, index) => {
    const value = base + Math.sin((index + seed) / 4.2) * amplitude + Math.sin((index * 7 + seed) / 3.1) * amplitude * 0.45;
    return Math.max(floor, Math.round(value * 10) / 10);
  });
}

function proc(overrides) {
  const command = overrides.command || overrides.name;
  const executablePath = overrides.executable || command.split(' ')[0];
  const appBundle = (executablePath.match(/^.*?\/([^/]+)\.app\/Contents\//) || [])[1] || null;
  const category = overrides.category || 'user-app';
  return {
    pid: 0,
    ppid: 1,
    user: USER,
    cpuPercent: 0,
    memoryPercent: 0.2,
    rssKb: 40000,
    vszKb: 400000,
    elapsed: '01:00:00',
    state: 'S',
    tty: null,
    cpuTimeSeconds: 12,
    executable: executablePath.startsWith('/') ? executablePath : null,
    uptimeSeconds: 3600,
    ports: [],
    networkConnections: [],
    network: { downloadBps: 0, uploadBps: 0, downloadedBytes: null, uploadedBytes: null, status: 'available', connectionCount: 0 },
    description: 'User-owned command or background helper.',
    tags: [],
    confidence: 'high',
    evidence: ['No specific process rule matched'],
    safeToTerminate: true,
    cleanCandidate: false,
    impactScore: 5,
    riskLevel: 'low',
    agentSessionId: null,
    ...overrides,
    command,
    category,
    provenance: {
      executablePath,
      executableName: executablePath.split('/').filter(Boolean).at(-1) || overrides.name,
      appBundle,
      parentPid: overrides.ppid || 1,
      parentName: null,
      launchMethod: overrides.launchMethod || (appBundle ? 'App launched by launchd' : overrides.tty ? `zsh in ${overrides.tty}` : 'launchd (agent or orphaned)'),
      projectPath: overrides.projectPath || null,
      commandPreview: command.split(' ').slice(0, 4).join(' ')
    },
    serviceGroup: overrides.serviceGroup || {
      id: `app:${appBundle || overrides.name}`,
      label: appBundle || overrides.name,
      kind: category === 'macos-system' ? 'system' : 'app',
      detail: ''
    }
  };
}

function https(pid, remote, down, up) {
  return {
    networkConnections: [
      {
        localAddress: '192.0.2.10',
        localPort: 50000 + (pid % 1000),
        remoteAddress: remote,
        remotePort: 443,
        protocol: 'tcp',
        state: 'ESTABLISHED',
        direction: 'outbound',
        remoteScope: 'public-internet',
        service: 'HTTPS',
        encryptedLikely: true
      }
    ],
    network: { downloadBps: down, uploadBps: up, downloadedBytes: 4_000_000, uploadedBytes: 900_000, status: 'available', connectionCount: 1 }
  };
}

const system = (name, pid, extra = {}) =>
  proc({ name, pid, user: 'root', category: 'macos-system', command: `/usr/libexec/${name}`, safeToTerminate: false, evidence: ['Owned by root'], description: 'macOS system service that supports core operating system behavior.', ...extra });

const processes = [
  system('launchd', 1, { command: '/sbin/launchd', ppid: 0, cpuTimeSeconds: 9120, uptimeSeconds: 1_200_000 }),
  system('kernel_task', 0, { command: 'kernel_task', ppid: 0, cpuPercent: 6.8, rssKb: 2_400_000, cpuTimeSeconds: 88_000 }),
  system('WindowServer', 402, { user: '_windowserver', command: '/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer', cpuPercent: 14.2, rssKb: 610_000, cpuTimeSeconds: 41_200, evidence: ['Owned by system account _windowserver'] }),
  system('logd', 405, { cpuPercent: 0.6, rssKb: 17_000 }),
  system('mds_stores', 612, { cpuPercent: 3.1, rssKb: 190_000 }),
  system('coreaudiod', 530, { user: '_coreaudiod', cpuPercent: 1.2, rssKb: 22_000 }),

  proc({ name: 'wezterm-gui', pid: 1503, executable: '/Applications/WezTerm.app/Contents/MacOS/wezterm-gui', cpuPercent: 3.4, rssKb: 280_000, cpuTimeSeconds: 1880, description: 'Part of the WezTerm app.', evidence: ['Executable lives inside WezTerm.app'] }),
  proc({ name: 'zsh', pid: 1516, ppid: 1503, command: '-zsh', tty: 'ttys000', rssKb: 3000, confidence: 'low' }),
  proc({ name: 'tmux', pid: 1600, ppid: 1516, executable: '/opt/homebrew/bin/tmux', tty: 'ttys000', rssKb: 6000, confidence: 'low' }),

  proc({ name: 'zsh', pid: 51740, ppid: 1600, command: '-zsh', tty: 'ttys011', rssKb: 3000, confidence: 'low' }),
  proc({
    name: 'claude',
    pid: 52209,
    ppid: 51740,
    command: 'claude --resume 56a99df1-9dec-41a7-9a8a-14f8a9d512b3',
    tty: 'ttys011',
    cpuPercent: 18.6,
    rssKb: 468_000,
    cpuTimeSeconds: 742,
    uptimeSeconds: 5_420,
    category: 'ai-agent',
    description: 'Claude Code coding agent running in ttys011.',
    tags: ['ai', 'coding-agent', 'claude'],
    evidence: ['Executable identified as Claude Code', 'Attached to terminal ttys011'],
    agentSessionId: 'claude:52209',
    ...https(52209, '160.79.104.10', 38_400, 12_600)
  }),
  proc({
    name: 'node',
    pid: 56411,
    ppid: 52209,
    executable: '/opt/homebrew/bin/node',
    command: '/opt/homebrew/bin/node /Users/demo/work/storefront/node_modules/.bin/vitest run',
    tty: 'ttys011',
    cpuPercent: 164.2,
    rssKb: 910_000,
    cpuTimeSeconds: 96,
    uptimeSeconds: 42,
    category: 'developer-tool',
    confidence: 'medium',
    description: 'Developer tool or build process.',
    tags: ['developer-tool', 'node'],
    evidence: ['Runs on the node toolchain', 'Attached to terminal ttys011'],
    projectPath: '/Users/demo/work/storefront',
    serviceGroup: { id: 'project:/Users/demo/work/storefront', label: 'storefront', kind: 'project', detail: '/Users/demo/work/storefront' },
    agentSessionId: 'claude:52209'
  }),
  proc({
    name: 'node',
    pid: 56420,
    ppid: 52209,
    executable: '/opt/homebrew/bin/node',
    command: '/opt/homebrew/bin/node /Users/demo/work/storefront/node_modules/.bin/vite --port 5173',
    tty: 'ttys011',
    cpuPercent: 2.4,
    rssKb: 240_000,
    cpuTimeSeconds: 31,
    uptimeSeconds: 1900,
    ports: [{ address: '127.0.0.1', port: 5173, protocol: 'tcp' }],
    category: 'local-server',
    description: 'Development server (vite) exposing a local web service.',
    tags: ['dev-server', 'node', 'port-listener'],
    evidence: ['Command runs dev server "vite"', 'Listening on TCP 5173'],
    cleanCandidate: true,
    projectPath: '/Users/demo/work/storefront',
    serviceGroup: { id: 'project:/Users/demo/work/storefront', label: 'storefront', kind: 'project', detail: '/Users/demo/work/storefront' },
    agentSessionId: 'claude:52209'
  }),
  proc({
    name: 'playwright-mcp',
    pid: 56430,
    ppid: 52209,
    executable: '/opt/homebrew/bin/node',
    command: '/opt/homebrew/bin/node /Users/demo/.npm/_npx/9833/node_modules/.bin/playwright-mcp --stdio',
    tty: 'ttys011',
    cpuPercent: 0.4,
    rssKb: 120_000,
    category: 'ai-agent',
    description: 'MCP server providing tools to an AI agent.',
    tags: ['ai', 'mcp'],
    evidence: ['Command references MCP (playwright-mcp)'],
    agentSessionId: 'claude:52209'
  }),

  proc({ name: 'zsh', pid: 60010, ppid: 1600, command: '-zsh', tty: 'ttys004', rssKb: 3000, confidence: 'low' }),
  proc({
    name: 'codex',
    pid: 60020,
    ppid: 60010,
    executable: '/opt/homebrew/bin/codex',
    tty: 'ttys004',
    cpuPercent: 4.1,
    rssKb: 182_000,
    cpuTimeSeconds: 210,
    uptimeSeconds: 11_300,
    category: 'ai-agent',
    description: 'Codex coding agent running in ttys004.',
    tags: ['ai', 'coding-agent', 'codex'],
    evidence: ['Executable identified as Codex', 'Attached to terminal ttys004'],
    agentSessionId: 'codex:60020',
    ...https(60020, '104.18.33.45', 4_100, 2_300)
  }),

  proc({ name: 'iTerm2', pid: 2100, executable: '/Applications/iTerm.app/Contents/MacOS/iTerm2', cpuPercent: 1.1, rssKb: 190_000, description: 'Part of the iTerm app.' }),
  proc({ name: 'zsh', pid: 2150, ppid: 2100, command: '-zsh', tty: 'ttys007', rssKb: 3000, confidence: 'low' }),
  proc({
    name: 'opencode',
    pid: 2160,
    ppid: 2150,
    executable: '/Users/demo/.opencode/bin/opencode',
    tty: 'ttys007',
    cpuPercent: 0.3,
    rssKb: 150_000,
    cpuTimeSeconds: 44,
    uptimeSeconds: 26_000,
    category: 'ai-agent',
    description: 'OpenCode coding agent running in ttys007.',
    tags: ['ai', 'coding-agent', 'opencode'],
    evidence: ['Executable identified as OpenCode'],
    agentSessionId: 'opencode:2160'
  }),
  proc({ name: 'zsh', pid: 2170, ppid: 2100, command: '-zsh', tty: 'ttys008', rssKb: 3000, confidence: 'low' }),
  proc({
    name: 'node',
    pid: 2180,
    ppid: 2170,
    executable: '/opt/homebrew/bin/node',
    command: '/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@google/gemini-cli/dist/index.js',
    tty: 'ttys008',
    cpuPercent: 0.1,
    rssKb: 132_000,
    cpuTimeSeconds: 18,
    uptimeSeconds: 3_100,
    category: 'ai-agent',
    description: 'Gemini CLI coding agent running in ttys008.',
    tags: ['ai', 'coding-agent', 'gemini'],
    evidence: ['Executable identified as Gemini CLI'],
    agentSessionId: 'gemini:2180'
  }),

  proc({ name: 'Cursor', pid: 1126, executable: '/Applications/Cursor.app/Contents/MacOS/Cursor', cpuPercent: 2.2, rssKb: 311_000, cpuTimeSeconds: 2200, description: 'Part of the Cursor app.' }),
  proc({ name: 'Cursor Helper (Renderer)', pid: 3598, ppid: 1126, executable: '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer)', cpuPercent: 9.4, rssKb: 690_000, cpuTimeSeconds: 1800, description: 'Part of the Cursor app.' }),
  proc({ name: 'Google Chrome', pid: 3001, executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', category: 'browser', cpuPercent: 5.2, rssKb: 420_000, cpuTimeSeconds: 5400, description: 'Google Chrome browser process.', ...https(3001, '142.250.72.14', 212_000, 18_300) }),
  proc({ name: 'Google Chrome Helper (Renderer)', pid: 3010, ppid: 3001, executable: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)', category: 'browser', cpuPercent: 22.8, rssKb: 1_240_000, cpuTimeSeconds: 3400, description: 'Google Chrome browser process.' }),
  proc({ name: 'Slack', pid: 3300, executable: '/Applications/Slack.app/Contents/MacOS/Slack', cpuPercent: 1.6, rssKb: 380_000, description: 'Part of the Slack app.', ...https(3300, '52.44.10.4', 1_900, 800) }),

  proc({
    name: 'mongod',
    pid: 47121,
    executable: '/opt/homebrew/bin/mongod',
    command: '/opt/homebrew/bin/mongod --config /opt/homebrew/etc/mongod.conf',
    cpuPercent: 0.8,
    rssKb: 298_000,
    uptimeSeconds: 183_845,
    ports: [{ address: '127.0.0.1', port: 27017, protocol: 'tcp' }],
    category: 'database',
    description: 'Local database or stateful storage service.',
    tags: ['database', 'port-listener'],
    evidence: ['Executable matches database "mongod"', 'Listening on TCP 27017'],
    riskLevel: 'medium'
  }),
  proc({
    name: 'node',
    pid: 61500,
    executable: '/opt/homebrew/bin/node',
    command: '/opt/homebrew/bin/node /Users/demo/.npm/_npx/1a2b/node_modules/.bin/github-mcp-server --stdio',
    cpuPercent: 0.2,
    rssKb: 96_000,
    uptimeSeconds: 20_472,
    category: 'ai-agent',
    description: 'MCP server left running after the agent that started it exited.',
    tags: ['ai', 'mcp', 'orphaned'],
    evidence: ['Command references MCP (github-mcp-server)', 'Parent exited; reparented to launchd'],
    cleanCandidate: true
  }),
  proc({
    name: 'node',
    pid: 61510,
    executable: '/opt/homebrew/bin/node',
    command: '/opt/homebrew/bin/node /Users/demo/work/docs-site/node_modules/.bin/next dev -p 3000',
    cpuPercent: 0.9,
    rssKb: 540_000,
    uptimeSeconds: 88_200,
    ports: [{ address: '*', port: 3000, protocol: 'tcp' }],
    category: 'local-server',
    description: 'Development server (next) exposing a local web service.',
    tags: ['dev-server', 'node', 'port-listener', 'orphaned'],
    evidence: ['Command runs dev server "next"', 'Parent exited; reparented to launchd', 'Listening on TCP 3000'],
    cleanCandidate: true,
    projectPath: '/Users/demo/work/docs-site',
    serviceGroup: { id: 'project:/Users/demo/work/docs-site', label: 'docs-site', kind: 'project', detail: '/Users/demo/work/docs-site' }
  }),
  proc({
    name: 'runner',
    pid: 91111,
    command: '/tmp/.cache/runner --serve',
    cpuPercent: 4.2,
    rssKb: 320_000,
    uptimeSeconds: 2643,
    ports: [{ address: '0.0.0.0', port: 7331, protocol: 'tcp' }],
    category: 'unknown',
    confidence: 'low',
    description: 'Unknown user process exposing a local network port.',
    tags: ['unknown', 'port-listener'],
    evidence: ['No known app or developer-tool rule matched', 'Listening on TCP 7331'],
    riskLevel: 'medium'
  })
];

for (let index = 0; index < 48; index += 1) {
  processes.push(
    system(['cfprefsd', 'distnoted', 'trustd', 'secinitd', 'mDNSResponder', 'bluetoothd', 'powerd', 'airportd'][index % 8], 700 + index, {
      cpuPercent: Math.round(((index * 37) % 17) * 0.1 * 10) / 10,
      rssKb: 6000 + ((index * 911) % 40) * 1000,
      user: index % 3 ? 'root' : '_mdnsresponder'
    })
  );
}

const byPid = new Map(processes.map((process) => [process.pid, process]));
for (const process of processes) {
  process.provenance.parentName = byPid.get(process.ppid)?.name ?? null;
  process.memoryPercent = Math.round((process.rssKb / 16_777_216) * 1000) / 10;
}

const history = wave(120, 34, 12, 3, 4).map((cpu, index) => ({
  t: NOW - (119 - index) * 3000,
  cpu,
  memory: 72 + Math.sin(index / 20) * 3,
  down: Math.max(0, Math.round(180_000 + Math.sin(index / 5) * 120_000)),
  up: Math.max(0, Math.round(40_000 + Math.sin(index / 3) * 22_000))
}));

function session(overrides) {
  return {
    host: { name: 'WezTerm', pid: 1503, appPath: '/Applications/WezTerm.app' },
    multiplexer: 'tmux',
    ports: [],
    connectionCount: 0,
    downloadBps: 0,
    uploadBps: 0,
    children: [],
    usage: null,
    safeToTerminate: true,
    statusSource: 'agent',
    title: null,
    resumeId: null,
    ...overrides
  };
}

const agents = [
  session({
    id: 'claude:52209',
    kind: 'claude',
    label: 'Claude Code',
    title: 'storefront-checkout-fix',
    rootPid: 52209,
    tty: 'ttys011',
    cwd: '/Users/demo/work/storefront',
    projectName: 'storefront',
    uptimeSeconds: 5420,
    status: 'working',
    cpuPercent: 185.6,
    memoryBytes: 1_738_000 * 1024,
    cpuTimeSeconds: 1904.2,
    processCount: 4,
    cpuHistory: wave(60, 120, 70, 1, 2),
    memoryHistory: wave(60, 1.6e9, 1.4e8, 2, 1e9),
    ports: [{ address: '127.0.0.1', port: 5173, protocol: 'tcp' }],
    connectionCount: 1,
    downloadBps: 38_400,
    uploadBps: 12_600,
    children: [
      { pid: 56411, name: 'node', cpuPercent: 164.2, rssKb: 910_000, commandPreview: 'node vitest run', depth: 1 },
      { pid: 56420, name: 'node', cpuPercent: 2.4, rssKb: 240_000, commandPreview: 'node vite --port 5173', depth: 1 },
      { pid: 56430, name: 'playwright-mcp', cpuPercent: 0.4, rssKb: 120_000, commandPreview: 'node playwright-mcp --stdio', depth: 1 }
    ],
    commandPreview: 'claude --resume 56a99df1-9dec-41a7-9a8a-14f8a9d512b3',
    resumeId: '56a99df1-9dec-41a7-9a8a-14f8a9d512b3',
    usage: {
      source: 'claude-transcript',
      sessionId: '56a99df1-9dec-41a7-9a8a-14f8a9d512b3',
      model: 'claude-opus-5-5',
      inputTokens: 18_220,
      outputTokens: 412_880,
      cacheReadTokens: 21_400_000,
      cacheWriteTokens: 910_300,
      reasoningTokens: 120_400,
      totalTokens: 22_741_400,
      contextTokens: 138_993,
      contextWindow: null,
      turns: 214,
      lastActivityAt: new Date(NOW - 4000).toISOString(),
      gitBranch: 'fix/checkout-rounding'
    }
  }),
  session({
    id: 'codex:60020',
    kind: 'codex',
    label: 'Codex',
    rootPid: 60020,
    tty: 'ttys004',
    cwd: '/Users/demo/work/api-gateway',
    projectName: 'api-gateway',
    uptimeSeconds: 11_300,
    status: 'waiting',
    statusSource: 'activity',
    cpuPercent: 4.1,
    memoryBytes: 182_000 * 1024,
    cpuTimeSeconds: 210,
    processCount: 1,
    cpuHistory: wave(60, 6, 5, 9, 0),
    memoryHistory: wave(60, 1.8e8, 1e7, 3, 1e8),
    connectionCount: 1,
    downloadBps: 4100,
    uploadBps: 2300,
    commandPreview: '/opt/homebrew/bin/codex',
    resumeId: '01a0d953-12af-7be2-9078-44058d1d8d25',
    usage: {
      source: 'codex-rollout',
      sessionId: '01a0d953-12af-7be2-9078-44058d1d8d25',
      model: 'gpt-5.6',
      inputTokens: 33_926,
      outputTokens: 3390,
      cacheReadTokens: 297_856,
      cacheWriteTokens: 0,
      reasoningTokens: 2009,
      totalTokens: 335_172,
      contextTokens: 44_076,
      contextWindow: 258_400,
      turns: 12,
      lastActivityAt: new Date(NOW - 190_000).toISOString(),
      gitBranch: null
    }
  }),
  session({
    id: 'opencode:2160',
    kind: 'opencode',
    label: 'OpenCode',
    rootPid: 2160,
    tty: 'ttys007',
    cwd: '/Users/demo/work/ml-pipeline',
    projectName: 'ml-pipeline',
    host: { name: 'iTerm2', pid: 2100, appPath: '/Applications/iTerm.app' },
    multiplexer: null,
    uptimeSeconds: 26_000,
    status: 'idle',
    statusSource: 'activity',
    cpuPercent: 0.3,
    memoryBytes: 150_000 * 1024,
    cpuTimeSeconds: 44,
    processCount: 1,
    cpuHistory: wave(60, 0.6, 0.5, 5, 0),
    memoryHistory: wave(60, 1.5e8, 2e6, 1, 1e8),
    commandPreview: '/Users/demo/.opencode/bin/opencode'
  }),
  session({
    id: 'gemini:2180',
    kind: 'gemini',
    label: 'Gemini CLI',
    rootPid: 2180,
    tty: 'ttys008',
    cwd: '/Users/demo/work/infra',
    projectName: 'infra',
    host: { name: 'iTerm2', pid: 2100, appPath: '/Applications/iTerm.app' },
    multiplexer: null,
    uptimeSeconds: 3100,
    status: 'idle',
    statusSource: 'activity',
    cpuPercent: 0.1,
    memoryBytes: 132_000 * 1024,
    cpuTimeSeconds: 18,
    processCount: 1,
    cpuHistory: wave(60, 0.3, 0.3, 7, 0),
    memoryHistory: wave(60, 1.3e8, 1e6, 1, 1e8),
    commandPreview: 'node /opt/homebrew/lib/node_modules/@google/gemini-cli/dist/index.js'
  })
];

function summary() {
  const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
  const clean = processes.filter((process) => process.cleanCandidate);
  return {
    totalProcesses: processes.length,
    userProcesses: processes.filter((process) => process.user === USER).length,
    macosSystem: processes.filter((process) => process.category === 'macos-system').length,
    localServers: processes.filter((process) => process.category === 'local-server').length,
    aiAgents: processes.filter((process) => process.category === 'ai-agent').length,
    databases: 1,
    listeningPorts: sum(processes, (process) => process.ports.length),
    cleanCandidates: clean.length,
    highCpu: processes.filter((process) => process.cpuPercent >= 10).length,
    highMemory: processes.filter((process) => process.rssKb >= 1024 * 1024).length,
    unknownNetworkListeners: 1,
    internetProcesses: processes.filter((process) => process.networkConnections.length).length,
    externalConnections: sum(processes, (process) => process.networkConnections.length),
    networkDownloadBps: sum(processes, (process) => process.network.downloadBps || 0),
    networkUploadBps: sum(processes, (process) => process.network.uploadBps || 0),
    cleanableMemoryMb: Math.round(sum(clean, (process) => process.rssKb) / 1024),
    cleanableCpuPercent: Math.round(sum(clean, (process) => process.cpuPercent) * 10) / 10,
    cpuTotal: Math.round(sum(processes, (process) => process.cpuPercent) * 10) / 10,
    memoryTotalMb: Math.round(sum(processes, (process) => process.rssKb) / 1024)
  };
}

const settings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  refreshMs: 3000,
  rememberApiKey: false,
  theme: 'light',
  agentUsage: true,
  menuBarMonitor: false,
  hasApiKey: false,
  encryptionAvailable: true
};

contextBridge.exposeInMainWorld('metalExplorer', {
  vibrancy: false,
  listProcesses: async () => {
    const snapshotSummary = summary();
    return {
      generatedAt: new Date(NOW).toISOString(),
      currentUser: USER,
      sampleIntervalMs: settings.refreshMs,
      processes,
      summary: snapshotSummary,
      agents,
      system: {
        cpuCores: 10,
        cpuUsagePercent: 38.4,
        loadAverage: [4.12, 3.8, 3.1],
        memoryTotalBytes: 16 * 1024 ** 3,
        memoryUsedBytes: 11.9 * 1024 ** 3,
        memoryWiredBytes: 2.4 * 1024 ** 3,
        memoryCompressedBytes: 3.1 * 1024 ** 3,
        swapUsedBytes: 1.2 * 1024 ** 3,
        memoryPressure: 'normal',
        networkDownloadBps: snapshotSummary.networkDownloadBps,
        networkUploadBps: snapshotSummary.networkUploadBps,
        history
      }
    };
  },
  getProcessHistory: async (pid) => ({
    pid,
    samples: wave(60, byPid.get(pid)?.cpuPercent || 1, Math.max(0.5, (byPid.get(pid)?.cpuPercent || 1) * 0.4), pid % 11, 0).map((cpu, index) => ({
      t: NOW - (59 - index) * 3000,
      cpu,
      rssKb: (byPid.get(pid)?.rssKb || 1000) * (0.9 + Math.sin(index / 9) * 0.05)
    }))
  }),
  terminateProcesses: async (targets) => targets.map((target) => ({ ok: true, pid: target.pid, message: `Mock SIGTERM sent to ${target.pid}.` })),
  openExternal: async () => undefined,
  revealAgentFolder: async () => true,
  focusAgentHost: async () => true,
  copyText: async () => undefined,
  getSettings: async () => ({ ...settings }),
  updateSettings: async (update) => {
    for (const [key, value] of Object.entries(update)) {
      if (key === 'apiKey') settings.hasApiKey = Boolean(value) || settings.hasApiKey;
      else if (key === 'clearApiKey') settings.hasApiKey = false;
      else settings[key] = value;
    }
    return { ...settings };
  },
  explainProcess: async () => ({
    summary: 'Mock explanation for visual smoke testing.',
    activity: 'Rendering a deterministic process snapshot.',
    resourceReason: 'The mock process simulates a development server under load.',
    safeToQuit: 'Safe in the mock environment.',
    riskLevel: 'low',
    recommendedAction: 'Use the local category and ports as the first signal.'
  }),
  exportDiagnostics: async () => ({ ok: true, message: 'Mock classification report exported.' }),
  onMenuCommand: () => () => undefined
});
