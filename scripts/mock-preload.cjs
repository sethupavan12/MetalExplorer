const { contextBridge } = require('electron');

const seedProcesses = [
  {
    pid: 84212,
    ppid: 84102,
    user: 'sethupavan12',
    cpuPercent: 18.4,
    memoryPercent: 4.1,
    rssKb: 864000,
    vszKb: 4500000,
    elapsed: '02:14:08',
    state: 'S',
    command: '/opt/homebrew/bin/node /Users/sethupavan12/work/agent-demo/node_modules/.bin/vite --host 127.0.0.1',
    name: 'node',
    uptimeSeconds: 8048,
    ports: [
      { address: '127.0.0.1', port: 5173, protocol: 'tcp' },
      { address: '*', port: 3000, protocol: 'tcp' }
    ],
    category: 'local-server',
    description: 'Node.js development process exposing a local web service.',
    tags: ['dev-server', 'node', 'port-listener'],
    safeToTerminate: true,
    cleanCandidate: true,
    impactScore: 42,
    riskLevel: 'low'
  },
  {
    pid: 61500,
    ppid: 61499,
    user: 'sethupavan12',
    cpuPercent: 9.8,
    memoryPercent: 2.8,
    rssKb: 512000,
    vszKb: 2300000,
    elapsed: '05:41:12',
    state: 'S',
    command: '/Users/sethupavan12/.local/bin/mcp-server --stdio',
    name: 'mcp-server',
    uptimeSeconds: 20472,
    ports: [],
    category: 'ai-agent',
    description: 'MCP or AI agent helper process coordinating tool calls or local automation.',
    tags: ['ai', 'agent'],
    safeToTerminate: true,
    cleanCandidate: true,
    impactScore: 31,
    riskLevel: 'low'
  },
  {
    pid: 47121,
    ppid: 1,
    user: 'sethupavan12',
    cpuPercent: 2.3,
    memoryPercent: 7.4,
    rssKb: 1298432,
    vszKb: 6800000,
    elapsed: '2-03:04:05',
    state: 'S',
    command: '/opt/homebrew/bin/mongod --config /opt/homebrew/etc/mongod.conf',
    name: 'mongod',
    uptimeSeconds: 183845,
    ports: [{ address: '127.0.0.1', port: 27017, protocol: 'tcp' }],
    category: 'database',
    description: 'Local database or stateful storage service.',
    tags: ['database', 'port-listener'],
    safeToTerminate: true,
    cleanCandidate: false,
    impactScore: 27,
    riskLevel: 'medium'
  },
  {
    pid: 405,
    ppid: 1,
    user: 'root',
    cpuPercent: 1.1,
    memoryPercent: 0.1,
    rssKb: 17312,
    vszKb: 435507328,
    elapsed: '58-06:29:55',
    state: 'Ss',
    command: '/usr/libexec/logd',
    name: 'logd',
    uptimeSeconds: 5034595,
    ports: [],
    category: 'macos-system',
    description: 'macOS system service that supports core operating system behavior.',
    tags: ['system'],
    safeToTerminate: false,
    cleanCandidate: false,
    impactScore: 4,
    riskLevel: 'low'
  },
  {
    pid: 91111,
    ppid: 1,
    user: 'sethupavan12',
    cpuPercent: 4.2,
    memoryPercent: 1.8,
    rssKb: 320000,
    vszKb: 1900000,
    elapsed: '44:03',
    state: 'S',
    command: '/tmp/.cache/runner --serve',
    name: 'runner',
    uptimeSeconds: 2643,
    ports: [{ address: '0.0.0.0', port: 7331, protocol: 'tcp' }],
    category: 'unknown',
    description: 'Unknown user process exposing a local network port.',
    tags: ['unknown', 'port-listener'],
    safeToTerminate: true,
    cleanCandidate: false,
    impactScore: 35,
    riskLevel: 'medium'
  }
];

const generatedProcesses = Array.from({ length: 40 }, (_, index) => {
  const seed = seedProcesses[index % seedProcesses.length];
  const pid = 92000 + index;

  return {
    ...seed,
    pid,
    ppid: seed.ppid,
    name: `${seed.name}-${index + 1}`,
    cpuPercent: Number(Math.max(0.2, seed.cpuPercent - (index % 7) * 0.6).toFixed(1)),
    rssKb: seed.rssKb + index * 8192,
    ports: [],
    cleanCandidate: false,
    command: `${seed.command} --mock-worker=${index + 1}`,
    description: `${seed.description} Mock row used to verify long process lists scroll correctly.`
  };
});

const networkByPid = new Map([
  [
    84212,
    [
      {
        localAddress: '192.168.29.37',
        localPort: 54000,
        remoteAddress: '104.18.20.123',
        remotePort: 443,
        protocol: 'tcp',
        state: 'ESTABLISHED'
      }
    ]
  ],
  [
    91111,
    [
      {
        localAddress: '192.168.29.37',
        localPort: 54001,
        remoteAddress: '8.8.8.8',
        remotePort: 443,
        protocol: 'tcp',
        state: 'ESTABLISHED'
      }
    ]
  ]
]);

function addNetwork(process) {
  const networkConnections = networkByPid.get(process.pid) || [];
  const hasNetwork = networkConnections.length > 0;
  return {
    ...process,
    networkConnections,
    network: {
      downloadBps: hasNetwork ? (process.pid === 84212 ? 121000 : 24000) : 0,
      uploadBps: hasNetwork ? (process.pid === 84212 ? 53000 : 8200) : 0,
      downloadedBytes: hasNetwork ? 1200000 : null,
      uploadedBytes: hasNetwork ? 420000 : null,
      status: hasNetwork ? 'available' : 'available',
      connectionCount: networkConnections.length
    }
  };
}

const processes = [...seedProcesses, ...generatedProcesses].map(addNetwork);
const currentSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  refreshMs: 3000,
  rememberApiKey: false,
  theme: 'light',
  hasApiKey: false,
  encryptionAvailable: true
};

contextBridge.exposeInMainWorld('metalExplorer', {
  listProcesses: async () => ({
    generatedAt: new Date().toISOString(),
    currentUser: 'sethupavan12',
    processes,
    summary: {
      totalProcesses: processes.length,
      userProcesses: processes.filter((process) => process.user === 'sethupavan12').length,
      macosSystem: 41,
      localServers: 3,
      aiAgents: 2,
      databases: 1,
      listeningPorts: 8,
      cleanCandidates: 2,
      highCpu: 1,
      highMemory: 1,
      unknownNetworkListeners: 1,
      internetProcesses: processes.filter((process) => process.networkConnections.length > 0).length,
      externalConnections: processes.reduce((total, process) => total + process.networkConnections.length, 0),
      networkDownloadBps: processes.reduce((total, process) => total + (process.network.downloadBps || 0), 0),
      networkUploadBps: processes.reduce((total, process) => total + (process.network.uploadBps || 0), 0),
      cleanableMemoryMb: Math.round(processes.filter((process) => process.cleanCandidate).reduce((total, process) => total + process.rssKb, 0) / 1024),
      cleanableCpuPercent: Number(processes.filter((process) => process.cleanCandidate).reduce((total, process) => total + process.cpuPercent, 0).toFixed(1)),
      cpuTotal: 52.4,
      memoryTotalMb: 13420
    }
  }),
  terminateProcess: async (pid) => ({ ok: true, message: `Mock SIGTERM sent to ${pid}.` }),
  getSettings: async () => currentSettings,
  updateSettings: async (settings) => {
    Object.assign(currentSettings, {
      baseUrl: settings.baseUrl || currentSettings.baseUrl,
      model: settings.model || currentSettings.model,
      refreshMs: settings.refreshMs || currentSettings.refreshMs,
      rememberApiKey: Boolean(settings.rememberApiKey),
      theme: settings.theme || currentSettings.theme,
      hasApiKey: Boolean(settings.apiKey) || currentSettings.hasApiKey,
      encryptionAvailable: true
    });
    return currentSettings;
  },
  explainProcess: async () => ({
    summary: 'Mock explanation for visual smoke testing.',
    activity: 'Rendering a deterministic process snapshot.',
    resourceReason: 'The mock process simulates a development server under load.',
    safeToQuit: 'Safe in the mock environment.',
    riskLevel: 'low',
    recommendedAction: 'Use the local category and ports as the first signal.'
  })
});
