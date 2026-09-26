import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { AgentUsage } from '../shared/types';
import type { AgentRoot, ClaudeSessionState } from './agents';
import { parseClaudeSessionState } from './agents';

/**
 * Reads token usage that coding agents already record on this Mac. Only numeric usage fields, model
 * names, timestamps, and branch names are extracted; message content is never kept or sent anywhere.
 */

const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const CODEX_TAIL_BYTES = 512 * 1024;
const CODEX_HEAD_MAX_BYTES = 4 * 1024 * 1024;
const CODEX_RESCAN_MS = 30_000;
const CODEX_MAX_DAYS = 14;
/** Unfinished lines longer than this are dropped rather than held in memory between samples. */
const MAX_PARTIAL_CHARS = 1024 * 1024;

interface LineCursor {
  offset: number;
  partial: string;
  skipFragment: boolean;
  decoder: StringDecoder;
}

export interface ClaudeFileCursor extends LineCursor {
  messages: Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }>;
  model: string | null;
  contextTokens: number | null;
  lastActivityAt: string | null;
  gitBranch: string | null;
}

export interface CodexFileCursor extends LineCursor {
  sessionId: string | null;
  cwd: string | null;
  startedAt: number | null;
  model: string | null;
  totals: { input: number; cached: number; output: number; reasoning: number; total: number } | null;
  contextTokens: number | null;
  contextWindow: number | null;
  turns: number;
  /** False when reading started from the tail, so turn counts are incomplete. */
  complete: boolean;
  lastActivityAt: string | null;
}

interface CodexHead {
  sessionId: string | null;
  cwd: string | null;
  startedAt: number | null;
}

export class AgentUsageReader {
  private readonly claudeCursors = new Map<string, ClaudeFileCursor>();
  private readonly codexCursors = new Map<string, CodexFileCursor>();
  private readonly codexHeads = new Map<string, CodexHead>();
  private readonly codexAssignments = new Map<string, string>();
  private readonly codexLastScan = new Map<string, number>();

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

  async readUsage(roots: AgentRoot[], cwdByPid: Map<number, string>, claudeStates: Map<number, ClaudeSessionState>, now: number): Promise<Map<string, AgentUsage>> {
    const usage = new Map<string, AgentUsage>();

    // Resolve every session to at most one file first, so two sessions never share (and race on) a cursor.
    const claudeFiles = new Map<string, string>();
    const claimed = new Set<string>();
    const claudeRoots = roots.filter((root) => root.agent.kind === 'claude').sort((a, b) => b.process.uptimeSeconds - a.process.uptimeSeconds);
    for (const root of claudeRoots) {
      const state = claudeStates.get(root.process.pid);
      const cwd = state?.cwd ?? cwdByPid.get(root.process.pid);
      if (!cwd) continue;
      const file = await this.resolveClaudeFile(cwd, state?.sessionId ?? null, now - root.process.uptimeSeconds * 1000, claimed).catch(() => null);
      if (file) {
        claimed.add(file);
        claudeFiles.set(root.sessionId, file);
      }
    }

    await Promise.all(
      [...claudeFiles].map(async ([sessionId, file]) => {
        const result = await this.readClaude(file).catch(() => null);
        if (result) usage.set(sessionId, result);
      })
    );

    const liveCodexIds = new Set<string>();
    for (const root of roots.filter((candidate) => candidate.agent.kind === 'codex')) {
      liveCodexIds.add(root.sessionId);
      const cwd = cwdByPid.get(root.process.pid);
      const result = cwd ? await this.readCodex(root.sessionId, cwd, now - root.process.uptimeSeconds * 1000, now).catch(() => null) : null;
      if (result) usage.set(root.sessionId, result);
    }

    this.prune(new Set(claudeFiles.values()), liveCodexIds);
    return usage;
  }

  private prune(claudeFiles: Set<string>, liveCodexIds: Set<string>): void {
    for (const file of this.claudeCursors.keys()) {
      if (!claudeFiles.has(file)) this.claudeCursors.delete(file);
    }
    for (const id of [...this.codexAssignments.keys(), ...this.codexLastScan.keys()]) {
      if (!liveCodexIds.has(id)) {
        this.codexAssignments.delete(id);
        this.codexLastScan.delete(id);
      }
    }
    const assigned = new Set(this.codexAssignments.values());
    for (const file of this.codexCursors.keys()) {
      if (!assigned.has(file)) this.codexCursors.delete(file);
    }
  }

  private async resolveClaudeFile(cwd: string, sessionId: string | null, startedAt: number, claimed: Set<string>): Promise<string | null> {
    const projectDir = join(this.claudeHome, 'projects', encodeClaudeProjectPath(cwd));
    if (sessionId) {
      // A known session id is authoritative. If its transcript does not exist yet, report nothing rather than
      // borrowing another session's numbers from the same folder.
      const file = join(projectDir, `${sessionId}.jsonl`);
      return (await stat(file).catch(() => null)) ? file : null;
    }
    return newestFile(projectDir, '.jsonl', startedAt - 5000, claimed);
  }

  private async readClaude(file: string): Promise<AgentUsage | null> {
    const cursor = this.claudeCursors.get(file) ?? {
      ...newLineCursor(),
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

    if (!file && now - (this.codexLastScan.get(sessionKey) ?? 0) >= CODEX_RESCAN_MS) {
      this.codexLastScan.set(sessionKey, now);
      file = await this.matchCodexRollout(cwd, startedAt, now);
      if (file) this.codexAssignments.set(sessionKey, file);
    }
    if (!file) {
      return null;
    }

    const cursor = await this.codexCursor(file);
    await readAppended(file, cursor, (line) => applyCodexLine(cursor, line));
    if (!cursor.totals && !cursor.complete) {
      // The tail had no token count yet; replay the whole file once.
      Object.assign(cursor, newLineCursor(), { turns: 0, complete: true });
      await readAppended(file, cursor, (line) => applyCodexLine(cursor, line));
    }
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
      turns: cursor.complete ? cursor.turns : null,
      lastActivityAt: cursor.lastActivityAt,
      gitBranch: null
    };
  }

  /** Picks the unclaimed rollout in this folder that started closest to (and not long before) the process. */
  private async matchCodexRollout(cwd: string, startedAt: number, now: number): Promise<string | null> {
    const claimed = new Set(this.codexAssignments.values());
    let best: { path: string; distance: number } | null = null;
    for (const candidate of await this.codexCandidates(startedAt, now)) {
      if (claimed.has(candidate)) continue;
      const head = await this.codexHead(candidate);
      if (!head || head.cwd !== cwd) continue;
      const distance = Math.abs((head.startedAt ?? now) - startedAt);
      if (!best || distance < best.distance) best = { path: candidate, distance };
    }
    return best?.path ?? null;
  }

  private async codexHead(path: string): Promise<CodexHead | null> {
    const cached = this.codexHeads.get(path);
    if (cached) return cached;

    const firstLine = await readFirstLine(path, CODEX_HEAD_MAX_BYTES).catch(() => null);
    if (firstLine === null) return null;
    const probe = { ...newCodexCursor() };
    applyCodexLine(probe, firstLine);
    const head = { sessionId: probe.sessionId, cwd: probe.cwd, startedAt: probe.startedAt };
    this.codexHeads.set(path, head);
    return head;
  }

  private async codexCursor(path: string): Promise<CodexFileCursor> {
    const existing = this.codexCursors.get(path);
    if (existing) return existing;

    const head = await this.codexHead(path);
    const info = await stat(path);
    const cursor: CodexFileCursor = { ...newCodexCursor(), ...(head ?? {}) };
    // Totals are cumulative, so start near the end of large rollouts instead of replaying them.
    cursor.offset = Math.max(0, info.size - CODEX_TAIL_BYTES);
    cursor.skipFragment = cursor.offset > 0;
    cursor.complete = cursor.offset === 0;
    this.codexCursors.set(path, cursor);
    return cursor;
  }

  private async codexCandidates(startedAt: number, now: number): Promise<string[]> {
    const days = new Set<string>();
    const from = Math.max(startedAt - 86_400_000, now - CODEX_MAX_DAYS * 86_400_000);
    for (let time = from; time <= now + 86_400_000; time += 86_400_000) {
      const date = new Date(time);
      days.add(join(String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())));
    }

    const files: string[] = [];
    for (const day of days) {
      const dir = join(this.codexHome, 'sessions', day);
      for (const entry of await readdir(dir).catch(() => [] as string[])) {
        if (!entry.startsWith('rollout-') || !entry.endsWith('.jsonl')) continue;
        const path = join(dir, entry);
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs >= startedAt - 5000) files.push(path);
      }
    }

    // Heads are immutable, but only keep the ones that can still match.
    const live = new Set(files);
    for (const path of this.codexHeads.keys()) {
      if (!live.has(path)) this.codexHeads.delete(path);
    }
    return files;
  }
}

export function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Applies one transcript line. Only assistant lines with usage are fully parsed; timestamps and branch names on other
 * lines come from a cheap match on top-level keys, so large tool outputs are never JSON-parsed.
 */
export function applyClaudeLine(cursor: ClaudeFileCursor, line: string): void {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) {
    const timestamp = line.match(/"timestamp":"([^"]{10,40})"/)?.[1];
    if (timestamp) cursor.lastActivityAt = timestamp;
    const branch = line.match(/"gitBranch":"([^"]{1,120})"/)?.[1];
    if (branch) cursor.gitBranch = branch;
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
  // Streaming writes several lines per message; keep the latest usage for each message id.
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

function newLineCursor(): LineCursor {
  return { offset: 0, partial: '', skipFragment: false, decoder: new StringDecoder('utf8') };
}

function newCodexCursor(): CodexFileCursor {
  return {
    ...newLineCursor(),
    sessionId: null,
    cwd: null,
    startedAt: null,
    model: null,
    totals: null,
    contextTokens: null,
    contextWindow: null,
    turns: 0,
    complete: true,
    lastActivityAt: null
  };
}

async function readAppended(path: string, cursor: LineCursor, onLine: (line: string) => void): Promise<void> {
  const info = await stat(path);
  if (info.size < cursor.offset) {
    // The file was truncated or replaced; start over.
    Object.assign(cursor, newLineCursor());
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
      // The decoder keeps multi-byte characters that straddle chunk boundaries intact.
      const lines = (cursor.partial + cursor.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
      cursor.partial = lines.pop() ?? '';
      // When reading starts mid-line, the first piece is a fragment of an earlier record.
      if (cursor.skipFragment && lines.length) {
        lines.shift();
        cursor.skipFragment = false;
      }
      if (cursor.partial.length > MAX_PARTIAL_CHARS) {
        cursor.partial = '';
        cursor.skipFragment = true;
      }
      for (const line of lines) {
        onLine(line);
      }
    }
  } finally {
    await handle.close();
  }
}

async function readFirstLine(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    let text = '';
    let position = 0;
    while (position < maxBytes) {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      text += decoder.write(buffer.subarray(0, bytesRead));
      const newline = text.indexOf('\n');
      if (newline >= 0) return text.slice(0, newline);
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function newestFile(dir: string, extension: string, minMtimeMs: number, exclude: Set<string>): Promise<string | null> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  let best: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith(extension)) continue;
    const path = join(dir, entry);
    if (exclude.has(path)) continue;
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
