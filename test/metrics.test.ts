import { describe, expect, it } from 'vitest';
import { parseStreamMetrics } from '../src/metrics.js';

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
    expect(metrics.hookEventSequence).toEqual([]);
    expect(metrics.permissionPrompts).toBe(0);
    expect(metrics.permissionDenied).toBe(0);
  });

  it('preserves the order of real hook_started lifecycle messages', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'project-pre', hook_event: 'PreToolUse' }),
      JSON.stringify({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'project-pre', hook_event: 'PreToolUse', exit_code: 0 }),
      JSON.stringify({ type: 'system', subtype: 'hook_started', hook_id: 'h2', hook_name: 'project-post', hook_event: 'PostToolUse' }),
    ].join('\n');

    const metrics = parseStreamMetrics(stream);
    expect(metrics.hookEventSequence).toEqual(['PreToolUse', 'PostToolUse']);
    expect(metrics.hookEvents).toEqual(['PostToolUse', 'PreToolUse', 'project-post', 'project-pre']);
    expect(metrics.permissionPrompts).toBe(0);
    expect(metrics.permissionDenied).toBe(0);
  });

  it('does not mistake raw hook stdin fields for stream lifecycle messages', () => {
    const metrics = parseStreamMetrics(JSON.stringify({
      type: 'system',
      hook_event_name: 'PermissionRequest',
      permission_mode: 'default',
      tool_name: 'Bash',
    }));

    expect(metrics.hookEventSequence).toEqual([]);
    expect(metrics.permissionPrompts).toBe(0);
  });

  it('tolerates non-json diagnostic lines', () => {
    const metrics = parseStreamMetrics('not json\n' + JSON.stringify({ type: 'result', usage: { input_tokens: 1, output_tokens: 2 } }));
    expect(metrics.parseErrors).toBe(1);
    expect(metrics.totalTokens).toBe(3);
  });
});
