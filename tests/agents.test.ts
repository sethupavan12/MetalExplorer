import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCodingAgent } from '../src/main/agent-catalog';
import { AgentUsageReader, encodeClaudeProjectPath } from '../src/main/agent-usage';
import {
  buildAgentSessions,
  createAgentTrackerState,
  findAgentRoots,
  parseClaudeSessionState,
  parseLsofCwdOutput,
  parseResumeId
} from '../src/main/agents';
import { buildProcessesFromOutputs } from '../src/main/processes';

const psOutput = `
1503 1 demo 0.5 1.0 100000 1000 04:00:00 0:30.00 S ?? /Applications/WezTerm.app/Contents/MacOS/wezterm-gui
1516 1503 demo 0.0 0.1 2000 1000 03:59:00 0:00.10 Ss ttys000 -zsh
6485 1516 demo 0.0 0.1 2000 1000 03:58:00 0:00.10 S+ ttys000 /Users/demo/.local/bin/tmux
51740 6485 demo 0.0 0.1 2000 1000 11:10 0:00.10 Ss ttys011 -zsh
52209 51740 demo 14.9 2.0 455008 1000 11:09 0:12.37 S+ ttys011 claude --resume 56a99df1-9dec-41a7-9a8a-14f8a9d512b3
56410 52209 demo 0.0 0.1 3000 1000 00:10 0:00.00 S ttys011 /usr/bin/caffeinate -i
56411 52209 demo 20.0 0.5 90000 1000 00:10 0:02.00 S ttys011 /opt/homebrew/bin/node /Users/demo/app/node_modules/.bin/vitest run
60000 1516 demo 3.0 0.5 90000 1000 05:00 0:09.00 S+ ttys002 /opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js
60001 60000 demo 1.0 0.5 90000 1000 05:00 0:04.00 S+ ttys002 /opt/homebrew/lib/node_modules/@openai/codex/vendor/codex/codex
`;

const commOutput = `
1503 /Applications/WezTerm.app/Contents/MacOS/wezterm-gui
1516 -zsh
6485 /Users/demo/.local/bin/tmux
51740 -zsh
52209 claude
56410 /usr/bin/caffeinate
56411 /opt/homebrew/bin/node
60000 /opt/homebrew/bin/node
60001 /opt/homebrew/lib/node_modules/@openai/codex/vendor/codex/codex
`;

const lsofOutput = `
COMMAND     PID       USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      56411 demo   20u  IPv4 0xd5f0a80305b99b81      0t0  TCP 127.0.0.1:51204 (LISTEN)
`;

function processes() {
  return buildProcessesFromOutputs({ psOutput, commOutput, lsofOutput, currentUser: 'demo', currentPid: 1, sampledAtMs: 1_000_000 }).processes;
}

describe('detectCodingAgent', () => {
  it('detects agents by exact executable, process title, or package path', () => {
    expect(detectCodingAgent({ name: 'claude', executable: null, command: 'claude' })?.kind).toBe('claude');
    expect(detectCodingAgent({ name: 'node', executable: '/opt/homebrew/bin/node', command: 'node /x/node_modules/@google/gemini-cli/dist/index.js' })?.kind).toBe('gemini');
    expect(detectCodingAgent({ name: 'opencode', executable: '/Users/demo/.opencode/bin/opencode', command: '/Users/demo/.opencode/bin/opencode' })?.kind).toBe('opencode');
    expect(detectCodingAgent({ name: 'AMPLibraryAgent', executable: '/System/Library/AMPLibraryAgent', command: '/System/Library/AMPLibraryAgent' })).toBeNull();
    expect(detectCodingAgent({ name: 'node', executable: '/opt/homebrew/bin/node', command: 'node server.js --name claude' })).toBeNull();
  });
});

describe('findAgentRoots', () => {
  it('treats agents spawned by an agent as part of the outer session', () => {
    const roots = findAgentRoots(processes());
    expect(roots.map((root) => [root.process.pid, root.agent.kind])).toEqual([
      [52209, 'claude'],
      [60000, 'codex']
    ]);
  });
});

describe('buildAgentSessions', () => {
  it('aggregates the whole process tree, finds the terminal host, and reports status from Claude state', () => {
    const list = processes();
    const state = createAgentTrackerState();
    const sessions = buildAgentSessions(list, findAgentRoots(list), {
      cwdByPid: new Map([[60000, '/Users/demo/api']]),
      claudeStates: new Map([[52209, { sessionId: 'abc', cwd: '/Users/demo/app', name: 'app-7', status: 'busy' }]]),
      usageBySession: new Map(),
      state,
      historyLength: 5,
      now: 1_000_000
    });

    const claude = sessions.find((session) => session.kind === 'claude');
    expect(claude).toMatchObject({
      rootPid: 52209,
      title: 'app-7',
      cwd: '/Users/demo/app',
      projectName: 'app',
      tty: 'ttys011',
      host: { name: 'WezTerm', pid: 1503, appPath: '/Applications/WezTerm.app' },
      multiplexer: 'tmux',
      status: 'working',
      statusSource: 'agent',
      cpuPercent: 34.9,
      processCount: 3,
      ports: [{ address: '127.0.0.1', port: 51204, protocol: 'tcp' }],
      resumeId: 'abc'
    });
    expect(claude?.children.map((child) => child.pid)).toEqual([56411, 56410]);
    expect(list.find((process) => process.pid === 56411)?.agentSessionId).toBe('claude:52209');

    const codex = sessions.find((session) => session.kind === 'codex');
    expect(codex).toMatchObject({ processCount: 2, cpuPercent: 4, projectName: 'api', status: 'working', statusSource: 'activity' });
  });

  it('keeps CPU time from descendants that already exited', () => {
    const state = createAgentTrackerState();
    const inputs = { cwdByPid: new Map(), claudeStates: new Map(), usageBySession: new Map(), state, historyLength: 5, now: 0 };
    const first = processes();
    buildAgentSessions(first, findAgentRoots(first), inputs);

    const withoutVitest = first.filter((process) => process.pid !== 56411);
    const [claude] = buildAgentSessions(withoutVitest, findAgentRoots(withoutVitest), inputs).filter((session) => session.kind === 'claude');
    expect(claude.cpuTimeSeconds).toBe(14.4);
    expect(claude.processCount).toBe(2);
  });
});

describe('agent parsers', () => {
  it('parses resume ids, lsof cwd output, and Claude session state', () => {
    expect(parseResumeId('claude --resume 7b79496a')).toBe('7b79496a');
    expect(parseResumeId('codex resume 01a0')).toBe('01a0');
    expect(parseResumeId('claude --session-id=abc')).toBe('abc');
    expect(parseResumeId('claude --allow-dangerously-skip-permissions')).toBeNull();
    expect(parseLsofCwdOutput('p9689\nfcwd\nn/Users/demo/a b\np52209\nfcwd\nn/tmp\n')).toEqual(
      new Map([
        [9689, '/Users/demo/a b'],
        [52209, '/tmp']
      ])
    );
    expect(parseClaudeSessionState('{"sessionId":"s","cwd":"/x","name":"n","status":"idle","messagingSocketPath":"/tmp/s"}')).toEqual({
      sessionId: 's',
      cwd: '/x',
      name: 'n',
      status: 'idle'
    });
    expect(parseClaudeSessionState('not json')).toBeNull();
  });
});

describe('AgentUsageReader', () => {
  it('sums Claude transcript usage once per message and reads appended lines incrementally', async () => {
    const home = mkdtempSync(join(tmpdir(), 'me-claude-'));
    const cwd = '/Users/demo/my_app';
    const dir = join(home, 'projects', encodeClaudeProjectPath(cwd));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sess-1.jsonl');
    const line = (id: string, output: number, timestamp: string) =>
      `${JSON.stringify({
        type: 'assistant',
        timestamp,
        gitBranch: 'main',
        message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: output } }
      })}\n`;
    writeFileSync(file, `${JSON.stringify({ type: 'user', timestamp: '2026-09-26T10:00:00.000Z', message: { content: 'secret prompt' } })}\n`);
    appendFileSync(file, line('m1', 20, '2026-09-26T10:00:01.000Z'));
    appendFileSync(file, line('m1', 40, '2026-09-26T10:00:02.000Z'));

    const reader = new AgentUsageReader(home, join(home, 'codex'));
    const roots = findAgentRoots(processes()).filter((root) => root.agent.kind === 'claude');
    const states = new Map([[52209, { sessionId: 'sess-1', cwd, name: null, status: null }]]);

    const first = await reader.readUsage(roots, new Map(), states, Date.now());
    expect(first.get('claude:52209')).toMatchObject({
      model: 'claude-opus-5-5',
      inputTokens: 10,
      outputTokens: 40,
      cacheReadTokens: 100,
      cacheWriteTokens: 5,
      totalTokens: 155,
      contextTokens: 115,
      turns: 1,
      gitBranch: 'main',
      lastActivityAt: '2026-09-26T10:00:02.000Z'
    });
    expect(JSON.stringify(first.get('claude:52209'))).not.toContain('secret prompt');

    appendFileSync(file, line('m2', 7, '2026-09-26T10:01:00.000Z'));
    const second = await reader.readUsage(roots, new Map(), states, Date.now());
    expect(second.get('claude:52209')).toMatchObject({ outputTokens: 47, turns: 2 });
  });

  it('matches a Codex rollout by working directory and reads cumulative token totals', async () => {
    const home = mkdtempSync(join(tmpdir(), 'me-codex-'));
    const now = new Date();
    const day = join(home, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
    mkdirSync(day, { recursive: true });
    const rollout = join(day, 'rollout-test.jsonl');
    writeFileSync(
      rollout,
      [
        { type: 'session_meta', timestamp: now.toISOString(), payload: { id: 'codex-1', cwd: '/Users/demo/api', timestamp: now.toISOString() } },
        { type: 'turn_context', timestamp: now.toISOString(), payload: { model: 'gpt-5.6', cwd: '/Users/demo/api' } },
        {
          type: 'event_msg',
          timestamp: now.toISOString(),
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 20, total_tokens: 1050 },
              last_token_usage: { input_tokens: 400 },
              model_context_window: 258400
            }
          }
        }
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const reader = new AgentUsageReader(join(home, 'claude'), home);
    const roots = findAgentRoots(processes()).filter((root) => root.agent.kind === 'codex');
    const usage = await reader.readUsage(roots, new Map([[60000, '/Users/demo/api']]), new Map(), Date.now());
    expect(usage.get('codex:60000')).toMatchObject({
      sessionId: 'codex-1',
      model: 'gpt-5.6',
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 50,
      reasoningTokens: 20,
      totalTokens: 1050,
      contextTokens: 400,
      contextWindow: 258400,
      turns: 1
    });
  });
});
