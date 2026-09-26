import { describe, expect, it } from 'vitest';
import {
  buildProcessesFromOutputs,
  classifyProcess,
  createSamplerState,
  detectAppBundle,
  parseCpuTime,
  parseEstablishedLsofOutput,
  parseElapsedToSeconds,
  parseLsofOutput,
  parseNettopOutput,
  parsePsOutput
} from '../src/main/processes';
import type { RawProcessInfo } from '../src/shared/types';

const psOutput = `
12720 501 demo-user 12.3 4.5 123456 987654 01:02:03 0:10.00 S+ ttys003 /opt/homebrew/bin/node /Users/demo-user/project/node_modules/.bin/vite --host 127.0.0.1
405 1 root 0.9 0.1 17312 435507328 58-06:29:55 12:01.50 Ss ?? /usr/libexec/logd
61500 1 demo-user 0.1 0.2 20000 400000 01:02:12 0:00.40 S ?? /Users/demo-user/.local/bin/mcp-server --stdio
45110 1 demo-user 1.5 1.2 50124 450000 2-03:04:05 3:00.00 S ?? /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter
`;

const lsofOutput = `
COMMAND     PID       USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12720 demo-user   20u  IPv6 0xd5f0a80305b99b80      0t0  TCP *:3000 (LISTEN)
node      12720 demo-user   21u  IPv4 0xd5f0a80305b99b81      0t0  TCP 127.0.0.1:5173 (LISTEN)
mongod    47121 demo-user    9u  IPv4 0xdf8f692d7b1c74b0      0t0  TCP 127.0.0.1:27017 (LISTEN)
mongod    47121 demo-user   10u  IPv6 0x2c070dc3869233c9      0t0  TCP [::1]:27017 (LISTEN)
rapportd   1099 demo-user   14u  IPv4 0x41c7b7756ebc896d      0t0  TCP 127.0.0.1:56535 (LISTEN)
rapportd   1099 demo-user   15u  IPv6 0xd820e2ec8594ae7b      0t0  TCP *:56535 (LISTEN)
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

function raw(overrides: Partial<RawProcessInfo>): RawProcessInfo {
  return {
    pid: 100,
    ppid: 50,
    user: 'demo-user',
    cpuPercent: 0,
    memoryPercent: 0,
    rssKb: 1000,
    vszKb: 1000,
    elapsed: '10:00',
    state: 'S',
    tty: null,
    cpuTimeSeconds: 0,
    executable: null,
    command: 'unknown',
    name: 'unknown',
    uptimeSeconds: 600,
    ...overrides
  };
}

describe('parseElapsedToSeconds', () => {
  it('parses macOS ps elapsed formats', () => {
    expect(parseElapsedToSeconds('02:12')).toBe(132);
    expect(parseElapsedToSeconds('01:02:03')).toBe(3723);
    expect(parseElapsedToSeconds('2-03:04:05')).toBe(183845);
  });
});

describe('parseCpuTime', () => {
  it('parses cumulative cpu time including minutes above 60 and days', () => {
    expect(parseCpuTime('0:01.23')).toBe(1.23);
    expect(parseCpuTime('517:12.33')).toBe(31032.33);
    expect(parseCpuTime('1-02:03:04')).toBe(93784);
  });
});

describe('parsePsOutput', () => {
  it('parses process rows, tty, cpu time and preserves commands with spaces', () => {
    const processes = parsePsOutput(psOutput);

    expect(processes[0]).toMatchObject({
      pid: 12720,
      ppid: 501,
      user: 'demo-user',
      cpuPercent: 12.3,
      memoryPercent: 4.5,
      tty: 'ttys003',
      cpuTimeSeconds: 10,
      name: 'node',
      command: '/opt/homebrew/bin/node /Users/demo-user/project/node_modules/.bin/vite --host 127.0.0.1',
      uptimeSeconds: 3723
    });

    expect(processes[1]).toMatchObject({ pid: 405, name: 'logd', tty: null, command: '/usr/libexec/logd' });
  });

  it('uses the ps comm path so app names with spaces are not truncated', () => {
    const [chrome] = parsePsOutput(
      '900 1 demo-user 1.0 1.0 1000 1000 01:00 0:01.00 S ?? /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag',
      new Map([[900, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']])
    );
    expect(chrome.name).toBe('Google Chrome');
    expect(chrome.executable).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('keeps process titles such as `claude` from comm when there is no path', () => {
    const [claude] = parsePsOutput('52209 51740 demo-user 5.0 1.0 1000 1000 11:09 0:12.37 S+ ttys011 claude --resume abc', new Map([[52209, 'claude']]));
    expect(claude.name).toBe('claude');
  });
});

describe('parseLsofOutput', () => {
  it('extracts unique listening ports by pid and keeps the most exposed bind address', () => {
    expect(parseLsofOutput(lsofOutput)).toEqual(
      new Map([
        [
          12720,
          [
            { address: '*', port: 3000, protocol: 'tcp' },
            { address: '127.0.0.1', port: 5173, protocol: 'tcp' }
          ]
        ],
        [47121, [{ address: '127.0.0.1', port: 27017, protocol: 'tcp' }]],
        [1099, [{ address: '*', port: 56535, protocol: 'tcp' }]]
      ])
    );
  });
});

describe('parseEstablishedLsofOutput', () => {
  it('extracts public internet TCP connections and skips loopback', () => {
    const connections = parseEstablishedLsofOutput(establishedLsofOutput);
    expect(connections.get(12720)).toEqual([
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
    ]);
    expect(connections.get(45110)?.[0]).toMatchObject({ remoteAddress: '2001:db8:2::1', remoteScope: 'public-internet' });
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

describe('detectAppBundle', () => {
  it('reports the outer app for nested helper bundles', () => {
    expect(detectAppBundle('/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer)')).toBe('Cursor');
    expect(detectAppBundle('/opt/homebrew/bin/node')).toBeNull();
  });
});

describe('classifyProcess', () => {
  it('classifies local dev servers, orphaned MCP servers, and macOS system processes', () => {
    const [vite, logd, mcp] = parsePsOutput(psOutput);

    expect(classifyProcess({ ...vite, ports: [{ address: '*', port: 3000, protocol: 'tcp' }] })).toMatchObject({
      category: 'local-server',
      confidence: 'high',
      evidence: ['Command runs dev server "vite"', 'Listening on TCP 3000'],
      safeToTerminate: true,
      cleanCandidate: true
    });

    expect(classifyProcess({ ...logd, ports: [] })).toMatchObject({ category: 'macos-system', confidence: 'high', safeToTerminate: false });

    expect(classifyProcess({ ...mcp, ports: [] })).toMatchObject({
      category: 'ai-agent',
      confidence: 'high',
      tags: ['ai', 'mcp', 'orphaned'],
      cleanCandidate: true
    });
  });

  it('never suggests stopping a live coding agent session', () => {
    const claude = raw({ name: 'claude', command: 'claude --resume abc', tty: 'ttys011' });
    expect(classifyProcess({ ...claude, ports: [] })).toMatchObject({
      category: 'ai-agent',
      tags: ['ai', 'coding-agent', 'claude'],
      cleanCandidate: false
    });
  });

  it('does not match agent or browser names as substrings', () => {
    const amp = raw({
      executable: '/Users/demo-user/Library/Frameworks/AMPDevices.framework/AMPDeviceDiscoveryAgent',
      command: '/Users/demo-user/Library/Frameworks/AMPDevices.framework/AMPDeviceDiscoveryAgent',
      name: 'AMPDeviceDiscoveryAgent'
    });
    expect(classifyProcess({ ...amp, ports: [] }).category).toBe('user-app');

    const knowledge = raw({ command: '/usr/local/bin/knowledge-edge-sync', name: 'knowledge-edge-sync' });
    expect(classifyProcess({ ...knowledge, ports: [] }).category).not.toBe('browser');
  });

  it('treats underscore system accounts as macOS system processes', () => {
    const coreaudio = raw({ user: '_coreaudiod', command: '/usr/local/bin/helper', name: 'helper' });
    expect(classifyProcess({ ...coreaudio, ports: [] }).category).toBe('macos-system');
  });

  it('classifies app bundle helpers with high confidence and browsers by bundle', () => {
    const cursor = raw({
      executable: '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper',
      command: '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper --type=gpu',
      name: 'Cursor Helper'
    });
    expect(classifyProcess({ ...cursor, ports: [] })).toMatchObject({ category: 'user-app', confidence: 'high', description: 'Part of the Cursor app.' });

    const arc = raw({ executable: '/Applications/Arc.app/Contents/MacOS/Arc', command: '/Applications/Arc.app/Contents/MacOS/Arc', name: 'Arc' });
    expect(classifyProcess({ ...arc, ports: [] }).category).toBe('browser');
  });
});

describe('buildProcessesFromOutputs', () => {
  it('joins ports, classifications, summaries, and clean candidates', () => {
    const { processes, summary } = buildProcessesFromOutputs({
      psOutput,
      lsofOutput,
      establishedLsofOutput,
      networkSamples: parseNettopOutput(nettopOutput),
      currentUser: 'demo-user',
      currentPid: 99999,
      sampledAtMs: 1000
    });

    expect(processes.find((process) => process.pid === 12720)).toMatchObject({
      ports: [
        { address: '*', port: 3000, protocol: 'tcp' },
        { address: '127.0.0.1', port: 5173, protocol: 'tcp' }
      ],
      category: 'local-server',
      provenance: {
        executableName: 'node',
        executablePath: '/opt/homebrew/bin/node',
        launchMethod: 'JavaScript toolchain',
        parentName: null,
        parentPid: 501,
        projectPath: '/Users/demo-user/project'
      },
      serviceGroup: { id: 'project:/Users/demo-user/project', label: 'project', kind: 'project' },
      safeToTerminate: true,
      cleanCandidate: true,
      networkConnections: [{ remoteAddress: '8.8.8.8', remotePort: 443, service: 'HTTPS' }],
      network: { status: 'measuring', connectionCount: 1 }
    });

    expect(processes.find((process) => process.pid === 45110)).toMatchObject({ category: 'macos-system', safeToTerminate: false });

    expect(summary).toMatchObject({
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

  it('measures CPU from cumulative cpu time between samples instead of the decayed ps average', () => {
    const state = createSamplerState();
    const first = `12720 501 demo-user 90.0 1.0 1000 1000 01:00 0:10.00 S ttys003 /opt/homebrew/bin/node server.js`;
    const second = `12720 501 demo-user 90.0 1.0 1000 1000 01:02 0:11.00 S ttys003 /opt/homebrew/bin/node server.js`;
    const base = { lsofOutput: '', currentUser: 'demo-user', currentPid: 1, state };

    const one = buildProcessesFromOutputs({ ...base, psOutput: first, sampledAtMs: 60_000 });
    expect(one.processes[0].cpuPercent).toBe(90);

    const two = buildProcessesFromOutputs({ ...base, psOutput: second, sampledAtMs: 62_000 });
    expect(two.processes[0].cpuPercent).toBe(50);
  });

  it('prunes per-process sampler state for exited processes', () => {
    const state = createSamplerState();
    const base = { lsofOutput: '', currentUser: 'demo-user', currentPid: 1, state, networkSamples: parseNettopOutput(nettopOutput) };
    buildProcessesFromOutputs({ ...base, psOutput, sampledAtMs: 1000 });
    expect(state.cpu.has(61500)).toBe(true);

    buildProcessesFromOutputs({ ...base, psOutput: psOutput.split('\n').filter((line) => !line.includes('61500')).join('\n'), sampledAtMs: 4000 });
    expect(state.cpu.has(61500)).toBe(false);
  });

  it('refuses termination for processes owned by other users', () => {
    const { processes } = buildProcessesFromOutputs({ psOutput, lsofOutput: '', currentUser: 'someone-else', currentPid: 1, sampledAtMs: 1000 });
    expect(processes.every((process) => !process.safeToTerminate)).toBe(true);
  });
});
