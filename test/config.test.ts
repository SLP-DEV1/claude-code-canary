import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';

describe('scenario config', () => {
  it('applies safe defaults to a minimal scenario', () => {
    const scenario = parseScenario({ version: 1, name: 'demo', prompt: 'Do the thing' });
    expect(scenario.claude.executable).toBe('claude');
    expect(scenario.claude.include_hook_events).toBe(false);
    expect(scenario.claude.timeout_seconds).toBe(900);
  });

  it('accepts semantic assertions and relative regression thresholds', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'semantic-regression',
      prompt: 'Do the thing',
      expect: {
        permissions: {
          max_prompts: 0,
          max_denied: 0,
          deny_prompted_tools: ['Read', 'mcp__*'],
        },
        hooks: {
          sequence: ['PreToolUse', 'PostToolUse'],
          deny_unexpected: false,
        },
      },
      regressions: {
        max_total_tokens_increase_pct: 25,
        max_reported_cost_increase_pct: 20,
        max_permission_prompts_increase: 0,
        require_same_hook_sequence: true,
      },
    });

    expect(scenario.expect?.permissions?.max_prompts).toBe(0);
    expect(scenario.expect?.hooks?.sequence).toEqual(['PreToolUse', 'PostToolUse']);
    expect(scenario.regressions?.max_total_tokens_increase_pct).toBe(25);
    expect(scenario.regressions?.require_same_hook_sequence).toBe(true);
  });

  it('rejects unknown schema versions', () => {
    expect(() => parseScenario({ version: 2, name: 'demo', prompt: 'x' })).toThrow(/Invalid Canary scenario/);
  });
});
