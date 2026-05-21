import { describe, expect, it } from 'vitest';
import {
  buildProcessSnapshotFromOutputs,
  classifyProcess,
  parseEstablishedLsofOutput,
  parseElapsedToSeconds,
  parseLsofOutput,
  parseNettopOutput,
  parsePsOutput
} from '../src/main/processes';

const psOutput = `
12720 501 demo-user 12.3 4.5 123456 987654 01:02:03 S+ /opt/homebrew/bin/node /Users/demo-user/project/node_modules/.bin/vite --host 127.0.0.1
405 1 root 0.9 0.1 17312 435507328 58-06:29:55 Ss /usr/libexec/logd
61500 61499 demo-user 0.1 0.2 20000 400000 02:12 S+ /Users/demo-user/.local/bin/mcp-server --stdio
45110 1 demo-user 1.5 1.2 50124 450000 2-03:04:05 S ControlCenter
`;

const lsofOutput = `
COMMAND     PID       USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12720 demo-user   20u  IPv6 0xd5f0a80305b99b80      0t0  TCP *:3000 (LISTEN)
node      12720 demo-user   21u  IPv4 0xd5f0a80305b99b81      0t0  TCP 127.0.0.1:5173 (LISTEN)
mongod    47121 demo-user    9u  IPv4 0xdf8f692d7b1c74b0      0t0  TCP 127.0.0.1:27017 (LISTEN)
mongod    47121 demo-user   10u  IPv6 0x2c070dc3869233c9      0t0  TCP [::1]:27017 (LISTEN)
`;

const establishedLsofOutput = `
COMMAND     PID       USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12720 demo-user   30u  IPv4 0xd5f0a80305b99b82      0t0  TCP 192.0.2.55:54000->8.8.8.8:443 (ESTABLISHED)
node      12720 demo-user   31u  IPv4 0xd5f0a80305b99b83      0t0  TCP 127.0.0.1:54001->127.0.0.1:5173 (ESTABLISHED)
ControlCe 45110 demo-user   12u  IPv6 0xd5f0a80305b99b84      0t0  TCP [2001:db8:1::1]:54002->[2001:db8:2::1]:443 (ESTABLISHED)
`;

const nettopOutput = `
,bytes_in,bytes_out,
node.12720,100000,50000,
ControlCenter.45110,200000,70000,
`;

describe('parseElapsedToSeconds', () => {
  it('parses macOS ps elapsed formats', () => {
    expect(parseElapsedToSeconds('02:12')).toBe(132);
    expect(parseElapsedToSeconds('01:02:03')).toBe(3723);
    expect(parseElapsedToSeconds('2-03:04:05')).toBe(183845);
  });
});

describe('parsePsOutput', () => {
  it('parses process rows and preserves commands with spaces', () => {
    const processes = parsePsOutput(psOutput);

    expect(processes[0]).toMatchObject({
      pid: 12720,
      ppid: 501,
      user: 'demo-user',
      cpuPercent: 12.3,
      memoryPercent: 4.5,
      name: 'node',
      command: '/opt/homebrew/bin/node /Users/demo-user/project/node_modules/.bin/vite --host 127.0.0.1',
      uptimeSeconds: 3723
    });

    expect(processes[1]).toMatchObject({
      pid: 405,
      name: 'logd',
      command: '/usr/libexec/logd'
    });
  });
});

describe('parseLsofOutput', () => {
  it('extracts unique listening ports by pid', () => {
    expect(parseLsofOutput(lsofOutput)).toEqual(
      new Map([
        [
          12720,
          [
            { address: '*', port: 3000, protocol: 'tcp' },
            { address: '127.0.0.1', port: 5173, protocol: 'tcp' }
          ]
        ],
        [47121, [{ address: '::1', port: 27017, protocol: 'tcp' }]]
      ])
    );
  });
});

describe('parseEstablishedLsofOutput', () => {
  it('extracts public internet TCP connections and skips loopback', () => {
    expect(parseEstablishedLsofOutput(establishedLsofOutput)).toEqual(
      new Map([
        [
          12720,
          [
            {
              localAddress: '192.0.2.55',
              localPort: 54000,
              remoteAddress: '8.8.8.8',
              remotePort: 443,
              protocol: 'tcp',
              state: 'ESTABLISHED',
              direction: 'outbound',
              remoteScope: 'public-internet',
              service: 'HTTPS',
              encryptedLikely: true
            }
          ]
        ],
        [
          45110,
          [
            {
              localAddress: '2001:db8:1::1',
              localPort: 54002,
              remoteAddress: '2001:db8:2::1',
              remotePort: 443,
              protocol: 'tcp',
              state: 'ESTABLISHED',
              direction: 'outbound',
              remoteScope: 'public-internet',
              service: 'HTTPS',
              encryptedLikely: true
            }
          ]
        ]
      ])
    );
  });
});

describe('parseNettopOutput', () => {
  it('extracts cumulative network byte counters by pid', () => {
    expect(parseNettopOutput(nettopOutput)).toEqual(
      new Map([
        [12720, { downloadedBytes: 100000, uploadedBytes: 50000 }],
        [45110, { downloadedBytes: 200000, uploadedBytes: 70000 }]
      ])
    );
  });
});

describe('classifyProcess', () => {
  it('classifies local dev servers, AI agents, and macOS system processes', () => {
    const [vite, logd, mcp] = parsePsOutput(psOutput);

    expect(classifyProcess({ ...vite, ports: [{ address: '*', port: 3000, protocol: 'tcp' }] })).toMatchObject({
      category: 'local-server',
      description: 'Node.js development process exposing a local web service.',
      confidence: 'high',
      evidence: ['Matched dev server hint "vite"', 'Listening on TCP 3000'],
      safeToTerminate: true
    });

    expect(classifyProcess({ ...logd, ports: [] })).toMatchObject({
      category: 'macos-system',
      confidence: 'high',
      safeToTerminate: false
    });

    expect(classifyProcess({ ...mcp, ports: [] })).toMatchObject({
      category: 'ai-agent',
      description: 'MCP or AI agent helper process coordinating tool calls or local automation.',
      confidence: 'high',
      evidence: ['Matched AI/agent hint "mcp"']
    });
  });
});

describe('buildProcessSnapshotFromOutputs', () => {
  it('joins ports, classifications, summaries, and clean candidates', () => {
    const snapshot = buildProcessSnapshotFromOutputs(
      psOutput,
      lsofOutput,
      establishedLsofOutput,
      parseNettopOutput(nettopOutput),
      'demo-user',
      99999,
      1000
    );

    expect(snapshot.processes.find((process) => process.pid === 12720)).toMatchObject({
      ports: [
        { address: '*', port: 3000, protocol: 'tcp' },
        { address: '127.0.0.1', port: 5173, protocol: 'tcp' }
      ],
      category: 'local-server',
      confidence: 'high',
      provenance: {
        executableName: 'node',
        executablePath: '/opt/homebrew/bin/node',
        launchMethod: 'JavaScript toolchain',
        parentName: null,
        parentPid: 501,
        projectPath: '/Users/demo-user/project',
        commandPreview: '/opt/homebrew/bin/node /Users/demo-user/project/node_modules/.bin/vite --host 127.0.0.1'
      },
      serviceGroup: {
        id: 'project:/Users/demo-user/project',
        label: 'project',
        kind: 'project',
        detail: '/Users/demo-user/project'
      },
      safeToTerminate: true,
      cleanCandidate: true
    });

    expect(snapshot.processes.find((process) => process.pid === 12720)).toMatchObject({
      networkConnections: [
        {
          remoteAddress: '8.8.8.8',
          remotePort: 443,
          service: 'HTTPS',
          remoteScope: 'public-internet'
        }
      ],
      network: {
        status: 'measuring',
        connectionCount: 1
      }
    });

    expect(snapshot.summary).toMatchObject({
      totalProcesses: 4,
      localServers: 1,
      aiAgents: 1,
      listeningPorts: 2,
      cleanCandidates: 2,
      internetProcesses: 2,
      externalConnections: 2,
      cleanableMemoryMb: 140,
      cleanableCpuPercent: 12.4
    });
  });
});
