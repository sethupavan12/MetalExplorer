import { describe, expect, it } from 'vitest';
import { evaluateTermination, parseIdentity } from '../src/main/sampler';
import { buildProcessesFromOutputs } from '../src/main/processes';
import { parsePressureLevel, parseSwapUsage, parseVmStat } from '../src/main/system';

const NOW = 1_000_000;
const command = '/opt/homebrew/bin/node /Users/demo/app/node_modules/.bin/vite';
const [reviewed] = buildProcessesFromOutputs({
  psOutput: `4242 100 demo 1.0 1.0 1000 1000 10:00 0:01.00 S ttys001 ${command}`,
  lsofOutput: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 4242 demo 20u IPv4 0x1 0t0 TCP 127.0.0.1:5173 (LISTEN)',
  currentUser: 'demo',
  currentPid: 1,
  sampledAtMs: NOW * 1000
}).processes;
const approved = { pid: 4242, startedAt: NOW - 600, command };
const context = { currentUser: 'demo', selfPid: 1, nowSeconds: NOW + 30, sampledAtSeconds: NOW };

describe('evaluateTermination', () => {
  it('allows stopping the exact process the user approved', () => {
    expect(evaluateTermination(approved, reviewed, { pid: 4242, user: 'demo', uptimeSeconds: 630, command }, context).allowed).toBe(true);
  });

  it('refuses when the PID was reused by another process while the sheet was open', () => {
    const reusedByLookalike = { pid: 4242, user: 'demo', uptimeSeconds: 5, command };
    const decision = evaluateTermination(approved, reviewed, reusedByLookalike, context);
    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/different process/);

    const reusedByOther = { pid: 4242, user: 'demo', uptimeSeconds: 630, command: '/usr/bin/other' };
    expect(evaluateTermination(approved, reviewed, reusedByOther, context).allowed).toBe(false);
  });

  it('refuses when the latest sample no longer matches what was approved', () => {
    const [newer] = buildProcessesFromOutputs({
      psOutput: `4242 100 demo 1.0 1.0 1000 1000 00:05 0:00.10 S ttys001 ${command}`,
      lsofOutput: '',
      currentUser: 'demo',
      currentPid: 1,
      sampledAtMs: NOW * 1000
    }).processes;
    const live = { pid: 4242, user: 'demo', uptimeSeconds: 630, command };
    expect(evaluateTermination(approved, newer, live, context).allowed).toBe(false);
  });

  it('refuses exited, protected, and other-user processes', () => {
    expect(evaluateTermination(approved, reviewed, null, context).message).toMatch(/no longer running/);
    expect(evaluateTermination({ ...approved, pid: 1 }, reviewed, { pid: 1, user: 'root', uptimeSeconds: 630, command }, context).allowed).toBe(false);
    expect(evaluateTermination(approved, reviewed, { pid: 4242, user: 'root', uptimeSeconds: 630, command }, context).allowed).toBe(false);
    expect(evaluateTermination(approved, { ...reviewed, safeToTerminate: false }, { pid: 4242, user: 'demo', uptimeSeconds: 630, command }, context).allowed).toBe(false);
  });

  it('parses ps identity rows with commands containing spaces', () => {
    expect(parseIdentity('4242 demo 10:30 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag').get(4242)).toEqual({
      pid: 4242,
      user: 'demo',
      uptimeSeconds: 630,
      command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag'
    });
  });
});

describe('system parsers', () => {
  it('computes memory used like Activity Monitor', () => {
    const vmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     8959.
Pages active:                                 261034.
Pages wired down:                             174474.
Pages purgeable:                                4531.
Anonymous pages:                              355566.
Pages occupied by compressor:                 308859.`;
    expect(parseVmStat(vmStat)).toEqual({
      usedBytes: (355566 - 4531 + 174474 + 308859) * 16384,
      wiredBytes: 174474 * 16384,
      compressedBytes: 308859 * 16384
    });
    expect(parseVmStat('garbage')).toBeNull();
  });

  it('parses memory pressure levels and swap usage', () => {
    expect(parsePressureLevel('1')).toBe('normal');
    expect(parsePressureLevel('2')).toBe('warning');
    expect(parsePressureLevel('4')).toBe('critical');
    expect(parsePressureLevel('')).toBe('unknown');
    expect(parseSwapUsage('total = 2048.00M  used = 1202.88M  free = 845.12M  (encrypted)')).toBe(Math.round(1202.88 * 1024 ** 2));
    expect(parseSwapUsage('total = 0.00M  used = 0.00M')).toBe(0);
  });
});
