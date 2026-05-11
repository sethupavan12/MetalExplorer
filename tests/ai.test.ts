import { describe, expect, it } from 'vitest';
import { parseAiExplanationResponse, redactCommandForAi } from '../src/main/ai';

describe('parseAiExplanationResponse', () => {
  it('extracts JSON explanation from fenced model output', () => {
    const explanation = parseAiExplanationResponse(`
\`\`\`json
{
  "summary": "Vite dev server for a local web app.",
  "activity": "Serving files on localhost.",
  "resourceReason": "CPU rises during rebuilds.",
  "safeToQuit": "Usually safe if you are not using the app.",
  "riskLevel": "low",
  "recommendedAction": "Keep it while coding, terminate when done."
}
\`\`\`
`);

    expect(explanation).toEqual({
      summary: 'Vite dev server for a local web app.',
      activity: 'Serving files on localhost.',
      resourceReason: 'CPU rises during rebuilds.',
      safeToQuit: 'Usually safe if you are not using the app.',
      riskLevel: 'low',
      recommendedAction: 'Keep it while coding, terminate when done.'
    });
  });

  it('returns a useful fallback when the model ignores the JSON contract', () => {
    expect(parseAiExplanationResponse('This appears to be a normal macOS helper.')).toEqual({
      summary: 'This appears to be a normal macOS helper.',
      activity: 'The model returned an unstructured explanation.',
      resourceReason: 'No structured resource reason was provided.',
      safeToQuit: 'Review the process details before terminating it.',
      riskLevel: 'unknown',
      recommendedAction: 'Use the local description and process owner as the source of truth.'
    });
  });

  it('does not expose raw JSON when the model nests JSON inside summary', () => {
    const explanation = parseAiExplanationResponse(
      JSON.stringify({
        summary: JSON.stringify({
          summary: 'Node is serving a local development app.',
          activity: 'Serving local assets.',
          resourceReason: 'CPU can spike during rebuilds.',
          safeToQuit: 'Safe if you are done using the dev server.',
          riskLevel: 'low',
          recommendedAction: 'Leave it running while coding.'
        }),
        activity: 'Outer activity',
        resourceReason: 'Outer reason',
        safeToQuit: 'Outer quit',
        riskLevel: 'medium',
        recommendedAction: 'Outer action'
      })
    );

    expect(explanation.summary).toBe('Node is serving a local development app.');
    expect(explanation.summary).not.toContain('{');
    expect(explanation.activity).toBe('Serving local assets.');
  });
});

describe('redactCommandForAi', () => {
  it('redacts common secret-bearing command arguments before AI requests', () => {
    const command =
      'node server.js --api-key example-api-key --token=example-token OPENAI_API_KEY=example-openai -H Authorization:Bearer example-bearer --client-secret "example-client-secret"';

    const redacted = redactCommandForAi(command);

    expect(redacted).toContain('--api-key [redacted]');
    expect(redacted).toContain('--token=[redacted]');
    expect(redacted).toContain('OPENAI_API_KEY=[redacted]');
    expect(redacted).toContain('Authorization:[redacted]');
    expect(redacted).toContain('--client-secret [redacted]');
    expect(redacted).not.toContain('example-api-key');
    expect(redacted).not.toContain('example-token');
    expect(redacted).not.toContain('example-openai');
    expect(redacted).not.toContain('example-bearer');
    expect(redacted).not.toContain('example-client-secret');
  });
});
