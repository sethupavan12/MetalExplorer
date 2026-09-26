import { execFile } from 'node:child_process';
import { cpus, loadavg, totalmem, userInfo } from 'node:os';
import { promisify } from 'node:util';
import type { AgentSession, ProcessHistory, ProcessInfo, ProcessSnapshot, SystemSample, SystemStats, TerminateResult, TerminateTarget } from '../shared/types';
import { AgentUsageReader } from './agent-usage';
import { buildAgentSessions, createAgentTrackerState, findAgentRoots, parseLsofCwdOutput, type ClaudeSessionState } from './agents';
import {
  NETTOP_ARGS,
  PS_ARGS,
  PS_COMM_ARGS,
  buildProcessesFromOutputs,
  createSamplerState,
  isProtectedProcess,
  parseElapsedToSeconds,
  parseNettopOutput,
  processStartKey
} from './processes';
import { parsePressureLevel, parseSwapUsage, parseVmStat } from './system';

const execFileAsync = promisify(execFile);
const SYSTEM_HISTORY_LENGTH = 120;
const PROCESS_HISTORY_LENGTH = 60;
const AGENT_HISTORY_LENGTH = 60;
const CWD_TTL_MS = 15_000;

async function run(file: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  try {
    const result = await execFileAsync(file, args, { maxBuffer, timeout: 10_000 });
    return result.stdout;
  } catch {
    return '';
  }
}

/**
 * Owns every piece of cross-sample state. History lives in memory only and is dropped when the app quits.
 */
export class Sampler {
  private readonly processState = createSamplerState();
  private readonly agentState = createAgentTrackerState();
  private readonly usageReader = new AgentUsageReader();
  private readonly systemHistory: SystemSample[] = [];
  private readonly processHistory = new Map<number, { startKey: string; samples: Array<{ t: number; cpu: number; rssKb: number }> }>();
  private readonly cwdCache = new Map<number, { cwd: string; at: number }>();
  private readonly currentUser = userInfo().username;
  private readonly cpuCores = cpus().length || 1;
  private inFlight: Promise<ProcessSnapshot> | null = null;
  private lastSnapshot: ProcessSnapshot | null = null;
  private lastSampleAt = 0;

  constructor(private readonly options: { agentInsights: () => boolean; intervalMs: () => number }) {}

  get latest(): ProcessSnapshot | null {
    return this.lastSnapshot;
  }

  /** Coalesces concurrent callers (renderer poll, tray, termination) into one sample. */
  sample(maxAgeMs = 500): Promise<ProcessSnapshot> {
    if (this.lastSnapshot && Date.now() - this.lastSampleAt < maxAgeMs) {
      return Promise.resolve(this.lastSnapshot);
    }
    if (!this.inFlight) {
      this.inFlight = this.collect().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  history(pid: number): ProcessHistory {
    return { pid, samples: [...(this.processHistory.get(pid)?.samples ?? [])] };
  }

  findProcess(pid: number): ProcessInfo | null {
    return this.lastSnapshot?.processes.find((process) => process.pid === pid) ?? null;
  }

  findAgent(sessionId: string): AgentSession | null {
    return this.lastSnapshot?.agents.find((session) => session.id === sessionId) ?? null;
  }

  async terminate(targets: TerminateTarget[]): Promise<TerminateResult[]> {
    const unique = [...new Map(targets.map((target) => [target.pid, target])).values()];
    if (!unique.length) {
      return [];
    }

    const known = new Map((this.lastSnapshot?.processes ?? []).map((process) => [process.pid, process]));
    const current = parseIdentity(await run('/bin/ps', ['-o', 'pid=,user=,etime=,args=', '-p', unique.map((target) => target.pid).join(',')]));
    const nowSeconds = Math.round(Date.now() / 1000);

    const results = unique.map((target): TerminateResult => {
      const reviewedProcess = known.get(target.pid);
      const decision = evaluateTermination(target, reviewedProcess ?? null, current.get(target.pid) ?? null, {
        currentUser: this.currentUser,
        selfPid: process.pid,
        nowSeconds,
        sampledAtSeconds: this.lastSnapshot ? Math.round(Date.parse(this.lastSnapshot.generatedAt) / 1000) : nowSeconds
      });
      if (!decision.allowed) {
        return { ok: false, pid: target.pid, message: decision.message };
      }

      try {
        process.kill(target.pid, 'SIGTERM');
        return { ok: true, pid: target.pid, message: `Sent SIGTERM to ${reviewedProcess?.name ?? 'process'} (${target.pid}).` };
      } catch (error) {
        return { ok: false, pid: target.pid, message: error instanceof Error ? error.message : 'Unknown termination error.' };
      }
    });

    this.lastSampleAt = 0;
    return results;
  }

  private async collect(): Promise<ProcessSnapshot> {
    const sampledAtMs = Date.now();
    const [psOutput, commOutput, lsofOutput, establishedLsofOutput, nettopOutput, vmStatOutput, sysctlOutput] = await Promise.all([
      run('/bin/ps', PS_ARGS),
      run('/bin/ps', PS_COMM_ARGS),
      run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']),
      run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:ESTABLISHED']),
      run('/usr/bin/nettop', NETTOP_ARGS),
      run('/usr/bin/vm_stat', []),
      run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level', 'vm.swapusage'])
    ]);

    if (!psOutput) {
      throw new Error('Unable to read the process list from /bin/ps.');
    }

    const { processes, summary } = buildProcessesFromOutputs({
      psOutput,
      commOutput,
      lsofOutput,
      establishedLsofOutput,
      networkSamples: parseNettopOutput(nettopOutput),
      currentUser: this.currentUser,
      currentPid: process.pid,
      sampledAtMs,
      state: this.processState
    });

    const agents = await this.collectAgents(processes, sampledAtMs);
    this.recordProcessHistory(processes, sampledAtMs);
    const system = this.buildSystemStats(summary.cpuTotal, summary.networkDownloadBps ?? 0, summary.networkUploadBps ?? 0, vmStatOutput, sysctlOutput, sampledAtMs);

    const snapshot: ProcessSnapshot = {
      generatedAt: new Date(sampledAtMs).toISOString(),
      currentUser: this.currentUser,
      sampleIntervalMs: this.options.intervalMs(),
      processes,
      summary,
      system,
      agents
    };

    this.lastSnapshot = snapshot;
    this.lastSampleAt = Date.now();
    return snapshot;
  }

  private async collectAgents(processes: ProcessInfo[], now: number): Promise<AgentSession[]> {
    const roots = findAgentRoots(processes);
    const cwdByPid = await this.resolveCwds(roots.map((root) => root.process.pid), now);
    const insights = this.options.agentInsights();
    const claudeStates: Map<number, ClaudeSessionState> = insights ? await this.usageReader.readClaudeStates(roots) : new Map();
    const usageBySession = insights ? await this.usageReader.readUsage(roots, cwdByPid, claudeStates, now) : new Map();

    return buildAgentSessions(processes, roots, {
      cwdByPid,
      claudeStates,
      usageBySession,
      state: this.agentState,
      historyLength: AGENT_HISTORY_LENGTH,
      now
    });
  }

  private async resolveCwds(pids: number[], now: number): Promise<Map<number, string>> {
    const stale = pids.filter((pid) => {
      const cached = this.cwdCache.get(pid);
      return !cached || now - cached.at > CWD_TTL_MS;
    });

    if (stale.length) {
      const resolved = parseLsofCwdOutput(await run('/usr/sbin/lsof', ['-a', '-p', stale.join(','), '-d', 'cwd', '-Fpn']));
      for (const [pid, cwd] of resolved) {
        this.cwdCache.set(pid, { cwd, at: now });
      }
    }

    const alive = new Set(pids);
    const result = new Map<number, string>();
    for (const [pid, entry] of this.cwdCache) {
      if (!alive.has(pid)) {
        this.cwdCache.delete(pid);
      } else {
        result.set(pid, entry.cwd);
      }
    }
    return result;
  }

  private recordProcessHistory(processes: ProcessInfo[], t: number): void {
    const alive = new Set<number>();
    for (const process of processes) {
      alive.add(process.pid);
      const startKey = processStartKey(process, t);
      const existing = this.processHistory.get(process.pid);
      // A reused pid starts a fresh chart instead of inheriting the previous process's history.
      const entry = existing && Math.abs(Number(existing.startKey) - Number(startKey)) <= 2 ? existing : { startKey, samples: [] };
      entry.samples.push({ t, cpu: process.cpuPercent, rssKb: process.rssKb });
      if (entry.samples.length > PROCESS_HISTORY_LENGTH) {
        entry.samples.shift();
      }
      this.processHistory.set(process.pid, entry);
    }
    for (const pid of this.processHistory.keys()) {
      if (!alive.has(pid)) {
        this.processHistory.delete(pid);
      }
    }
  }

  private buildSystemStats(cpuTotal: number, down: number, up: number, vmStatOutput: string, sysctlOutput: string, t: number): SystemStats {
    const memory = parseVmStat(vmStatOutput);
    const [pressureLine = '', swapLine = ''] = sysctlOutput.split('\n');
    const memoryTotalBytes = totalmem();
    const cpuUsagePercent = Math.min(100, Math.round((cpuTotal / this.cpuCores) * 10) / 10);
    const memoryUsedBytes = memory?.usedBytes ?? 0;

    this.systemHistory.push({ t, cpu: cpuUsagePercent, memory: memoryTotalBytes ? Math.round((memoryUsedBytes / memoryTotalBytes) * 1000) / 10 : 0, down, up });
    if (this.systemHistory.length > SYSTEM_HISTORY_LENGTH) {
      this.systemHistory.shift();
    }

    const [one, five, fifteen] = loadavg();
    return {
      cpuCores: this.cpuCores,
      cpuUsagePercent,
      loadAverage: [round2(one), round2(five), round2(fifteen)],
      memoryTotalBytes,
      memoryUsedBytes,
      memoryWiredBytes: memory?.wiredBytes ?? 0,
      memoryCompressedBytes: memory?.compressedBytes ?? 0,
      swapUsedBytes: parseSwapUsage(swapLine),
      memoryPressure: parsePressureLevel(pressureLine),
      networkDownloadBps: down,
      networkUploadBps: up,
      history: [...this.systemHistory]
    };
  }
}

const START_TOLERANCE_SECONDS = 3;

interface LiveIdentity {
  pid: number;
  user: string;
  uptimeSeconds: number;
  command: string;
}

/**
 * Decides whether a stop is allowed. The live process, the latest sample, and the identity the user approved in the
 * review sheet must all describe the same process, so a PID reused while the sheet was open is never signalled.
 */
export function evaluateTermination(
  target: TerminateTarget,
  reviewed: ProcessInfo | null,
  live: LiveIdentity | null,
  context: { currentUser: string; selfPid: number; nowSeconds: number; sampledAtSeconds: number }
): { allowed: boolean; message: string } {
  const name = reviewed?.name ?? `PID ${target.pid}`;
  if (!Number.isInteger(target.pid) || target.pid <= 1) {
    return { allowed: false, message: 'Protected process cannot be stopped.' };
  }
  if (!live) {
    return { allowed: false, message: `${name} (${target.pid}) is no longer running.` };
  }

  const liveStart = context.nowSeconds - live.uptimeSeconds;
  const sameAsApproved = live.command === target.command && Math.abs(liveStart - target.startedAt) <= START_TOLERANCE_SECONDS;
  if (!sameAsApproved) {
    return { allowed: false, message: `PID ${target.pid} now belongs to a different process. Nothing was stopped.` };
  }

  const reviewedStart = reviewed ? context.sampledAtSeconds - reviewed.uptimeSeconds : Number.NaN;
  if (!reviewed || reviewed.command !== target.command || Math.abs(reviewedStart - target.startedAt) > START_TOLERANCE_SECONDS) {
    return { allowed: false, message: `${name} (${target.pid}) changed since you reviewed it. Refresh and try again.` };
  }

  if (!reviewed.safeToTerminate || live.user !== context.currentUser || isProtectedProcess(live, context.selfPid)) {
    return { allowed: false, message: `${name} is protected or not owned by ${context.currentUser}.` };
  }

  return { allowed: true, message: '' };
}

export function parseIdentity(output: string): Map<number, { pid: number; user: string; uptimeSeconds: number; command: string }> {
  const identities = new Map<number, { pid: number; user: string; uptimeSeconds: number; command: string }>();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1], 10);
    identities.set(pid, { pid, user: match[2], uptimeSeconds: parseElapsedToSeconds(match[3]), command: match[4] });
  }
  return identities;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
