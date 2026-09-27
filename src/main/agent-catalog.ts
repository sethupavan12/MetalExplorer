import type { CodingAgentKind } from '../shared/types';

export interface CodingAgentDefinition {
  kind: CodingAgentKind;
  label: string;
  /** Executable or process-title names that identify the agent CLI. */
  names: string[];
  /** npm package directories whose entry script identifies the agent when run through a JS runtime. */
  packages: string[];
}

export const CODING_AGENTS: CodingAgentDefinition[] = [
  { kind: 'claude', label: 'Claude Code', names: ['claude'], packages: ['@anthropic-ai/claude-code'] },
  { kind: 'codex', label: 'Codex', names: ['codex'], packages: ['@openai/codex'] },
  { kind: 'opencode', label: 'OpenCode', names: ['opencode'], packages: ['opencode-ai'] },
  { kind: 'gemini', label: 'Gemini CLI', names: ['gemini'], packages: ['@google/gemini-cli'] },
  { kind: 'aider', label: 'Aider', names: ['aider'], packages: [] },
  { kind: 'amp', label: 'Amp', names: ['amp'], packages: ['@sourcegraph/amp'] },
  { kind: 'goose', label: 'Goose', names: ['goose'], packages: [] },
  { kind: 'crush', label: 'Crush', names: ['crush'], packages: ['@charmland/crush'] },
  { kind: 'qwen', label: 'Qwen Code', names: ['qwen'], packages: ['@qwen-code/qwen-code'] },
  { kind: 'cursor-agent', label: 'Cursor Agent', names: ['cursor-agent'], packages: [] },
  { kind: 'copilot', label: 'Copilot CLI', names: ['copilot'], packages: ['@github/copilot'] },
  { kind: 'droid', label: 'Factory Droid', names: ['droid'], packages: [] },
  { kind: 'kiro', label: 'Kiro CLI', names: ['kiro-cli'], packages: [] }
];

const AGENT_BY_KIND = new Map(CODING_AGENTS.map((agent) => [agent.kind, agent]));
const SCRIPT_RUNTIMES = new Set(['node', 'bun', 'deno', 'python', 'python3', 'tsx']);

export function codingAgentLabel(kind: CodingAgentKind): string {
  return AGENT_BY_KIND.get(kind)?.label ?? kind;
}

/**
 * Identifies an interactive coding agent CLI from exact executable names and package paths.
 * Substring matching is deliberately avoided: `amp` must not match `AMPDeviceDiscoveryAgent`.
 */
export function detectCodingAgent(input: { name: string; executable: string | null; command: string }): CodingAgentDefinition | null {
  const tokens = splitArgs(input.command);
  const executableName = basename(input.executable ?? tokens[0] ?? '').toLowerCase();
  const title = input.name.toLowerCase();

  for (const agent of CODING_AGENTS) {
    if (agent.names.includes(executableName) || agent.names.includes(title)) {
      return agent;
    }
  }

  const runtime = basename(tokens[0] ?? '').toLowerCase().replace(/[\d.]+$/, '');
  if (!SCRIPT_RUNTIMES.has(runtime) && !SCRIPT_RUNTIMES.has(executableName.replace(/[\d.]+$/, ''))) {
    return null;
  }

  const script = tokens.slice(1).find((token) => !token.startsWith('-'));
  if (!script) {
    return null;
  }

  const scriptName = basename(script).toLowerCase();
  for (const agent of CODING_AGENTS) {
    if (agent.packages.some((pkg) => script.includes(`/node_modules/${pkg}/`)) || agent.names.includes(scriptName)) {
      return agent;
    }
  }

  return null;
}

export function splitArgs(command: string): string[] {
  return (
    command
      .match(/"[^"]+"|'[^']+'|\S+/g)
      ?.map((token) => token.replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
      .filter(Boolean) ?? []
  );
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}
