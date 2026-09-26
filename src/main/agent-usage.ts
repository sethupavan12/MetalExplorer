import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentUsage } from '../shared/types';
import type { AgentRoot, ClaudeSessionState } from './agents';
import { parseClaudeSessionState } from './agents';

/**
 * Reads token usage that coding agents already record on this Mac. Only numeric usage fields, model
 * names, timestamps, and branch names are extracted; message content is never kept or sent anywhere.
 */

const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const CODEX_TAIL_BYTES = 512 * 1024;

interface ClaudeFileCursor {
  offset: number;
  partial: string;
  messages: Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }>;
  model: string | null;
  contextTokens: number | null;
  lastActivityAt: string | null;
  gitBranch: string | null;
}

interface CodexFileCursor {
  offset: number;
  partial: string;
  skipFragment: boolean;
  sessionId: string | null;
  cwd: string | null;
  startedAt: number | null;
  model: string | null;
  totals: { input: number; cached: number; output: number; reasoning: number; total: number } | null;
  contextTokens: number | null;
  contextWindow: number | null;
  turns: number;
  lastActivityAt: string | null;
}

export class AgentUsageReader {
  private readonly claudeCursors = new Map<string, ClaudeFileCursor>();
  private readonly codexCursors = new Map<string, CodexFileCursor>();
  private readonly codexAssignments = new Map<string, string>();

  constructor(
    private readonly claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
    private readonly codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  ) {}

  async readClaudeStates(roots: AgentRoot[]): Promise<Map<number, ClaudeSessionState>> {
    const states = new Map<number, ClaudeSessionState>();
    await Promise.all(
      roots
        .filter((root) => root.agent.kind === 'claude')
        .map(async (root) => {
          const raw = await readFile(join(this.claudeHome, 'sessions', `${root.process.pid}.json`), 'utf8').catch(() => null);
          const state = raw ? parseClaudeSessionState(raw) : null;
          if (state) {
            states.set(root.process.pid, state);
          }
        })
    );
    return states;
  }

  async readUsage(
    roots: AgentRoot[],
    cwdByPid: Map<number, string>,
    claudeStates: Map<number, ClaudeSessionState>,
    now: number
  ): Promise<Map<string, AgentUsage>> {
    const usage = new Map<string, AgentUsage>();
    const liveCodexIds = new Set<string>();
    const usedFiles = new Set<string>();

    await Promise.all(
      roots.map(async (root) => {
        const startedAt = now - root.process.uptimeSeconds * 1000;
        if (root.agent.kind === 'claude') {
          const state = claudeStates.get(root.process.pid);
          const cwd = state?.cwd ?? cwdByPid.get(root.process.pid);
          const result = cwd ? await this.readClaude(cwd, state?.sessionId ?? null, startedAt, usedFiles).catch(() => null) : null;
          if (result) {
            usage.set(root.sessionId, result);
          }
        }

        if (root.agent.kind === 'codex') {
          liveCodexIds.add(root.sessionId);
          const cwd = cwdByPid.get(root.process.pid);
          const result = cwd ? await this.readCodex(root.sessionId, cwd, startedAt, now).catch(() => null) : null;
          if (result) {
            usage.set(root.sessionId, result);
          }
        }
      })
    );

    for (const id of this.codexAssignments.keys()) {
      if (!liveCodexIds.has(id)) {
        this.codexAssignments.delete(id);
      }
    }
    for (const file of this.claudeCursors.keys()) {
      if (!usedFiles.has(file)) {
        this.claudeCursors.delete(file);
      }
    }
    const assigned = new Set(this.codexAssignments.values());
    for (const file of this.codexCursors.keys()) {
      if (!assigned.has(file)) {
        this.codexCursors.delete(file);
      }
    }

    return usage;
  }

  private async readClaude(cwd: string, sessionId: string | null, startedAt: number, usedFiles: Set<string>): Promise<AgentUsage | null> {
    const projectDir = join(this.claudeHome, 'projects', encodeClaudeProjectPath(cwd));
    let file = sessionId ? join(projectDir, `${sessionId}.jsonl`) : null;

    if (!file || !(await stat(file).catch(() => null))) {
      file = await newestFile(projectDir, '.jsonl', startedAt - 5000);
    }
    if (!file) {
      return null;
    }

    usedFiles.add(file);
    const cursor = this.claudeCursors.get(file) ?? {
      offset: 0,
      partial: '',
      messages: new Map(),
      model: null,
      contextTokens: null,
      lastActivityAt: null,
      gitBranch: null
    };
    this.claudeCursors.set(file, cursor);

    await readAppended(file, cursor, (line) => applyClaudeLine(cursor, line));

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let reasoning = 0;
    for (const message of cursor.messages.values()) {
      input += message.input;
      output += message.output;
      cacheRead += message.cacheRead;
      cacheWrite += message.cacheWrite;
      reasoning += message.reasoning;
    }

    return {
      source: 'claude-transcript',
      sessionId: file.split('/').at(-1)?.replace(/\.jsonl$/, '') ?? null,
      model: cursor.model,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      reasoningTokens: reasoning,
      totalTokens: input + output + cacheRead + cacheWrite,
      contextTokens: cursor.contextTokens,
      contextWindow: null,
      turns: cursor.messages.size,
      lastActivityAt: cursor.lastActivityAt,
      gitBranch: cursor.gitBranch
    };
  }

  private async readCodex(sessionKey: string, cwd: string, startedAt: number, now: number): Promise<AgentUsage | null> {
    let file = this.codexAssignments.get(sessionKey) ?? null;

    if (!file) {
      const claimed = new Set(this.codexAssignments.values());
      const candidates = await this.codexCandidates(startedAt, now);
      let best: { path: string; distance: number } | null = null;
      for (const candidate of candidates) {
        if (claimed.has(candidate)) {
          continue;
        }
        const cursor = await this.codexCursor(candidate);
        if (cursor.cwd !== cwd) {
          continue;
        }
        const distance = Math.abs((cursor.startedAt ?? now) - startedAt);
        if (!best || distance < best.distance) {
          best = { path: candidate, distance };
        }
      }
      file = best?.path ?? null;
      if (file) {
        this.codexAssignments.set(sessionKey, file);
      }
    }

    if (!file) {
      return null;
    }

    const cursor = await this.codexCursor(file);
    await readAppended(file, cursor, (line) => applyCodexLine(cursor, line));
    const totals = cursor.totals;

    return {
      source: 'codex-rollout',
      sessionId: cursor.sessionId,
      model: cursor.model,
      inputTokens: totals ? Math.max(0, totals.input - totals.cached) : 0,
      outputTokens: totals?.output ?? 0,
      cacheReadTokens: totals?.cached ?? 0,
      cacheWriteTokens: 0,
      reasoningTokens: totals?.reasoning ?? 0,
      totalTokens: totals?.total ?? 0,
      contextTokens: cursor.contextTokens,
      contextWindow: cursor.contextWindow,
      turns: cursor.turns,
      lastActivityAt: cursor.lastActivityAt,
      gitBranch: null
    };
  }

  private async codexCursor(path: string): Promise<CodexFileCursor> {
    const existing = this.codexCursors.get(path);
    if (existing) {
      return existing;
    }

    const cursor: CodexFileCursor = {
      offset: 0,
      partial: '',
      skipFragment: false,
      sessionId: null,
      cwd: null,
      startedAt: null,
      model: null,
      totals: null,
      contextTokens: null,
      contextWindow: null,
      turns: 0,
      lastActivityAt: null
    };
    this.codexCursors.set(path, cursor);

    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      const head = Buffer.alloc(Math.min(info.size, 64 * 1024));
      await handle.read(head, 0, head.length, 0);
      const firstLine = head.toString('utf8').split('\n')[0];
      applyCodexLine(cursor, firstLine);
      // Totals are cumulative, so start near the end of large rollouts instead of replaying them.
      cursor.offset = Math.max(0, info.size - CODEX_TAIL_BYTES);
      cursor.partial = '';
      cursor.skipFragment = cursor.offset > 0;
    } finally {
      await handle.close();
    }

    return cursor;
  }

  private async codexCandidates(startedAt: number, now: number): Promise<string[]> {
    const days = new Set<string>();
    for (let time = startedAt - 86_400_000; time <= now + 86_400_000; time += 86_400_000) {
      const date = new Date(time);
      days.add(join(String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())));
    }

    const files: string[] = [];
    for (const day of days) {
      const dir = join(this.codexHome, 'sessions', day);
      const entries = await readdir(dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.startsWith('rollout-') || !entry.endsWith('.jsonl')) {
          continue;
        }
        const path = join(dir, entry);
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs >= startedAt - 5000) {
          files.push(path);
        }
      }
    }
    return files;
  }
}

export function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function applyClaudeLine(cursor: ClaudeFileCursor, line: string): void {
  if (!line.includes('"timestamp"')) {
    return;
  }

  let entry: {
    type?: string;
    timestamp?: string;
    gitBranch?: string;
    message?: { id?: string; model?: string; usage?: Record<string, unknown> };
  };
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }

  if (typeof entry.timestamp === 'string') {
    cursor.lastActivityAt = entry.timestamp;
  }
  if (typeof entry.gitBranch === 'string' && entry.gitBranch) {
    cursor.gitBranch = entry.gitBranch.slice(0, 120);
  }

  const usage = entry.message?.usage;
  if (entry.type !== 'assistant' || !usage || typeof entry.message?.id !== 'string') {
    return;
  }

  if (typeof entry.message.model === 'string' && !entry.message.model.startsWith('<')) {
    cursor.model = entry.message.model.slice(0, 80);
  }

  const input = numberField(usage.input_tokens);
  const cacheRead = numberField(usage.cache_read_input_tokens);
  const cacheWrite = numberField(usage.cache_creation_input_tokens);
  const details = usage.output_tokens_details as Record<string, unknown> | undefined;
  cursor.messages.set(entry.message.id, {
    input,
    output: numberField(usage.output_tokens),
    cacheRead,
    cacheWrite,
    reasoning: numberField(details?.thinking_tokens)
  });
  cursor.contextTokens = input + cacheRead + cacheWrite;
}

export function applyCodexLine(cursor: CodexFileCursor, line: string): void {
  if (!line.includes('"session_meta"') && !line.includes('"token_count"') && !line.includes('"turn_context"')) {
    return;
  }

  let entry: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }

  const payload = entry.payload ?? {};
  if (entry.type === 'session_meta') {
    cursor.sessionId = typeof payload.id === 'string' ? payload.id : cursor.sessionId;
    cursor.cwd = typeof payload.cwd === 'string' ? payload.cwd : cursor.cwd;
    const started = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : Number.NaN;
    cursor.startedAt = Number.isFinite(started) ? started : cursor.startedAt;
    return;
  }

  if (entry.type === 'turn_context') {
    cursor.model = typeof payload.model === 'string' ? payload.model.slice(0, 80) : cursor.model;
    cursor.turns += 1;
    if (typeof entry.timestamp === 'string') {
      cursor.lastActivityAt = entry.timestamp;
    }
    return;
  }

  if (payload.type === 'token_count') {
    const info = payload.info as Record<string, Record<string, unknown> | number | undefined> | null | undefined;
    const total = info?.total_token_usage as Record<string, unknown> | undefined;
    const last = info?.last_token_usage as Record<string, unknown> | undefined;
    if (total) {
      cursor.totals = {
        input: numberField(total.input_tokens),
        cached: numberField(total.cached_input_tokens),
        output: numberField(total.output_tokens),
        reasoning: numberField(total.reasoning_output_tokens),
        total: numberField(total.total_tokens)
      };
    }
    if (last) {
      cursor.contextTokens = numberField(last.input_tokens);
    }
    if (typeof info?.model_context_window === 'number') {
      cursor.contextWindow = info.model_context_window;
    }
    if (typeof entry.timestamp === 'string') {
      cursor.lastActivityAt = entry.timestamp;
    }
  }
}

async function readAppended(path: string, cursor: { offset: number; partial: string; skipFragment?: boolean }, onLine: (line: string) => void): Promise<void> {
  const info = await stat(path);
  if (info.size < cursor.offset) {
    cursor.offset = 0;
    cursor.partial = '';
  }
  if (info.size === cursor.offset) {
    return;
  }

  const handle = await open(path, 'r');
  try {
    while (cursor.offset < info.size) {
      const length = Math.min(READ_CHUNK_BYTES, info.size - cursor.offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, cursor.offset);
      if (!bytesRead) {
        break;
      }
      cursor.offset += bytesRead;
      const text = cursor.partial + buffer.toString('utf8', 0, bytesRead);
      const lines = text.split('\n');
      cursor.partial = lines.pop() ?? '';
      // When reading starts mid-file the first line is a fragment of an earlier record.
      if (cursor.skipFragment && lines.length) {
        lines.shift();
        cursor.skipFragment = false;
      }
      for (const line of lines) {
        onLine(line);
      }
    }
  } finally {
    await handle.close();
  }
}

async function newestFile(dir: string, extension: string, minMtimeMs: number): Promise<string | null> {
  const entries = await readdir(dir).catch(() => []);
  let best: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith(extension)) {
      continue;
    }
    const path = join(dir, entry);
    const info = await stat(path).catch(() => null);
    if (info && info.mtimeMs >= minMtimeMs && (!best || info.mtimeMs > best.mtime)) {
      best = { path, mtime: info.mtimeMs };
    }
  }
  return best?.path ?? null;
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
