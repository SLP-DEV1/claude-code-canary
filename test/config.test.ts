import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';

describe('scenario config', () => {
  it('applies safe defaults to a minimal scenario', () => {
    const scenario = parseScenario({ version: 1, name: 'demo', prompt: 'Do the thing' });
    expect(scenario.claude.executable).toBe('claude');
    expect(scenario.claude.include_hook_events).toBe(false);
    expect(scenario.claude.timeout_seconds).toBe(900);
  });

  it('rejects unknown schema versions', () => {
    expect(() => parseScenario({ version: 2, name: 'demo', prompt: 'x' })).toThrow(/Invalid Canary scenario/);
  });
});
