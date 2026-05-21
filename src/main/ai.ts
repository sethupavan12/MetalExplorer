import type { AiExplanation, AppSettings, ProcessInfo } from '../shared/types';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function parseAiExplanationResponse(content: string): AiExplanation {
  const trimmed = content.trim();
  const jsonText = extractJson(trimmed);

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Partial<AiExplanation>;

      const normalized = normalizeExplanation(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Fall through to unstructured fallback.
    }
  }

  const nestedJson = extractJson(trimmed.replace(/\\n/g, '\n'));
  if (nestedJson && nestedJson !== jsonText) {
    try {
      const normalized = normalizeExplanation(JSON.parse(nestedJson) as Partial<AiExplanation>);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Fall through to unstructured fallback.
    }
  }

  return {
    summary: sanitizeSummary(trimmed) || 'No explanation was returned.',
    activity: 'The model returned an unstructured explanation.',
    resourceReason: 'No structured resource reason was provided.',
    safeToQuit: 'Review the process details before terminating it.',
    riskLevel: 'unknown',
    recommendedAction: 'Use the local description and process owner as the source of truth.'
  };
}

function normalizeExplanation(parsed: Partial<AiExplanation>): AiExplanation | null {
  const nestedSummary = typeof parsed.summary === 'string' ? extractJson(parsed.summary.replace(/\\n/g, '\n')) : null;
  if (nestedSummary) {
    try {
      return normalizeExplanation(JSON.parse(nestedSummary) as Partial<AiExplanation>);
    } catch {
      // Continue with the outer object.
    }
  }

  if (parsed.summary && parsed.activity && parsed.resourceReason && parsed.safeToQuit && parsed.recommendedAction) {
    return {
      summary: sanitizeSummary(parsed.summary),
      activity: sanitizeField(parsed.activity),
      resourceReason: sanitizeField(parsed.resourceReason),
      safeToQuit: sanitizeField(parsed.safeToQuit),
      riskLevel: normalizeRisk(parsed.riskLevel),
      recommendedAction: sanitizeField(parsed.recommendedAction)
    };
  }

  return null;
}

function sanitizeSummary(value: unknown): string {
  const text = sanitizeField(value);
  const nestedJson = extractJson(text.replace(/\\n/g, '\n'));
  if (nestedJson) {
    try {
      const parsed = JSON.parse(nestedJson) as Partial<AiExplanation>;
      if (typeof parsed.summary === 'string') {
        return sanitizeField(parsed.summary);
      }
    } catch {
      return text;
    }
  }

  return text;
}

function sanitizeField(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export async function explainProcessWithAi(process: ProcessInfo, settings: AppSettings & { apiKey?: string }): Promise<AiExplanation> {
  if (!settings.apiKey) {
    throw new Error('Add an API key in Settings before requesting AI explanations.');
  }

  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: 'system',
          content:
            'You explain macOS processes for non-expert local developers. Return strict JSON with keys summary, activity, resourceReason, safeToQuit, riskLevel, recommendedAction. riskLevel must be low, medium, high, or unknown. Be careful: do not claim a process is malware unless evidence is strong.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            name: process.name,
            pid: process.pid,
            ppid: process.ppid,
            user: process.user,
            cpuPercent: process.cpuPercent,
            memoryPercent: process.memoryPercent,
            memoryMb: Math.round(process.rssKb / 1024),
            uptimeSeconds: process.uptimeSeconds,
            ports: process.ports,
            category: process.category,
            confidence: process.confidence,
            evidence: process.evidence,
            provenance: process.provenance,
            serviceGroup: process.serviceGroup,
            localDescription: process.description,
            command: redactCommandForAi(process.command),
            safeToTerminateLocally: process.safeToTerminate
          })
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `AI request failed with HTTP ${response.status}.`);
  }

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI response did not include a message.');
  }

  return parseAiExplanationResponse(content);
}

export function redactCommandForAi(command: string): string {
  return command
    .replace(
      /((?:--?(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|client[-_]?secret|token|secret|password|passwd|pwd)|[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Z0-9_]*)=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      '$1[redacted]'
    )
    .replace(
      /(--?(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|client[-_]?secret|token|secret|password|passwd|pwd)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      '$1[redacted]'
    )
    .replace(/((?:Authorization|X-Api-Key):\s*)(?:"[^"]*"|'[^']*'|(?:Bearer\s+)?[^\s]+)/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
}

function extractJson(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function normalizeRisk(value: unknown): AiExplanation['riskLevel'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'unknown' ? value : 'unknown';
}
