/**
 * agentRunner error-sanitization tests.
 *
 * Scenario: an operator runs NemoClaw with real provider keys in env. A tool
 * or provider call fails and the raw error message echoes the API key (many
 * HTTP clients include the request URL / auth header in thrown errors). That
 * message must never reach conversationHistory verbatim — it would enter the
 * agent's own reasoning and could be repeated back to the user or logged.
 */
import { describe, it, expect } from 'vitest';
import { NemoClawAgent, sanitizeErrorMessage } from './agentRunner';
import { codebaseTools } from './codebaseContext';

const FAKE_KEY = 'sk-ant-FAKEKEY1234567890abcdef';

describe('sanitizeErrorMessage', () => {
  it('redacts API-key-shaped tokens and keeps a stable error class', () => {
    const out = sanitizeErrorMessage(new Error(`Anthropic: 401 invalid x-api-key ${FAKE_KEY}`));
    expect(out).not.toContain(FAKE_KEY);
    expect(out).toContain('[REDACTED]');
    expect(out).toMatch(/^\[(unknown|transient_network|rate_limited)\]/);
  });

  it('redacts Google keys, bearer headers, and key= query params', () => {
    const out = sanitizeErrorMessage(
      new Error('fetch failed https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIzaFakeGoogleKey12345 Authorization: Bearer abc.def-ghi'),
    );
    expect(out).not.toContain('AIzaFakeGoogleKey12345');
    expect(out).not.toContain('abc.def-ghi');
    expect(out).toContain('[transient_network]'); // "fetch failed" classifies as transient
  });

  it('strips stack traces and bounds length', () => {
    const err = new Error(`boom ${'x'.repeat(1000)}\n    at NemoClawAgent.run (agentRunner.ts:300:5)`);
    const out = sanitizeErrorMessage(err);
    expect(out).not.toContain('at NemoClawAgent.run');
    expect(out.length).toBeLessThanOrEqual(260);
  });

  it('handles non-Error throwables', () => {
    expect(sanitizeErrorMessage('raw string failure')).toContain('raw string failure');
    expect(sanitizeErrorMessage(undefined)).toContain('undefined');
  });
});

describe('NemoClawAgent conversationHistory', () => {
  it('never records a provider error containing an API key verbatim', async () => {
    // Provider key present so pickModel succeeds without network.
    process.env.GEMINI_API_KEY = 'AIzaTestOnlyKey1234567890';
    const agent = new NemoClawAgent({ maxTurns: 3 });

    // Router stubbed — no network.
    (agent as any).classifyIntent = async () => ({ intent: 'code', tier: 'free' });

    // Tool throws the way a real HTTP client does: key baked into the message.
    const original = codebaseTools.read_file.fn;
    (codebaseTools.read_file as any).fn = async () => {
      throw new Error(`401 Unauthorized for url with x-api-key ${FAKE_KEY}\n    at fetch (node:internal)`);
    };

    // Model stubbed: one tool call, then a final answer.
    let calls = 0;
    (agent as any).callModelWithTools = async () => {
      calls += 1;
      if (calls === 1) {
        return { text: '', toolCalls: [{ id: 't1', function: { name: 'read_file', arguments: '{"path":"x.ts"}' } }] };
      }
      return { text: 'done' };
    };

    try {
      await agent.run('read x.ts');
    } finally {
      (codebaseTools.read_file as any).fn = original;
      delete process.env.GEMINI_API_KEY;
    }

    const history: Array<{ role: string; content: string }> = (agent as any).conversationHistory;
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain(FAKE_KEY);

    const toolError = history.find((m) => m.role === 'tool' && m.content.includes('Error executing read_file'));
    expect(toolError).toBeDefined();
    expect(toolError!.content).toContain('[REDACTED]');
    expect(toolError!.content).not.toContain('at fetch'); // no stack trace
  });
});
