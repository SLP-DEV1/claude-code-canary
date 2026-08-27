import { describe, expect, it } from 'vitest';
import { extractStreamErrors, parseStreamMetrics } from '../src/metrics.js';

describe('stream metrics', () => {
  it('collects tool ids, usage and result metadata', () => {
    const stream = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read' }, { type: 'tool_use', id: 'tool-2', name: 'Edit' }] } }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.12, num_turns: 3, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } }),
    ].join('\n');

    const metrics = parseStreamMetrics(stream);
    expect(metrics.toolCalls).toBe(2);
    expect(metrics.totalTokens).toBe(180);
    expect(metrics.costUsd).toBe(0.12);
    expect(metrics.turns).toBe(3);
  });

  it('tolerates non-json diagnostic lines', () => {
    const metrics = parseStreamMetrics('not json\n' + JSON.stringify({ type: 'result', usage: { input_tokens: 1, output_tokens: 2 } }));
    expect(metrics.parseErrors).toBe(1);
    expect(metrics.totalTokens).toBe(3);
  });

  it('extracts result error messages without treating valid JSON as malformed', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        total_cost_usd: 0,
        errors: ['Authentication failed', 'Authentication failed'],
      }),
    ].join('\n');

    expect(extractStreamErrors(stream)).toEqual(['Authentication failed']);
    expect(parseStreamMetrics(stream).parseErrors).toBe(0);
    expect(parseStreamMetrics(stream).costUsd).toBe(0);
  });

  it('falls back to the result subtype when no explicit error text exists', () => {
    const stream = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true });
    expect(extractStreamErrors(stream)).toEqual(['Claude result subtype: error_max_turns']);
  });
});
