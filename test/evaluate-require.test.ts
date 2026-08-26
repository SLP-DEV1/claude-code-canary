import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import { evaluateExpectations } from '../src/evaluate.js';
import type { RunMetrics } from '../src/types.js';

const metrics: RunMetrics = {
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
  hookEvents: [],
  parseErrors: 0,
};

describe('required changed files', () => {
  it('fails when a required recorded file was not changed', async () => {
    const scenario = parseScenario({
      version: 1,
      name: 'recorded',
      prompt: 'Do the task',
      expect: {
        changed_files: {
          allow: ['src/**'],
          require: ['src/auth.ts'],
          deny: [],
        },
      },
    });

    const failures = await evaluateExpectations(scenario, process.cwd(), ['src/other.ts'], metrics);
    expect(failures).toContain('Required changed file missing: src/auth.ts');
  });

  it('accepts a matching required glob', async () => {
    const scenario = parseScenario({
      version: 1,
      name: 'recorded',
      prompt: 'Do the task',
      expect: {
        changed_files: {
          allow: ['src/**'],
          require: ['src/auth.*'],
          deny: [],
        },
      },
    });

    const failures = await evaluateExpectations(scenario, process.cwd(), ['src/auth.ts'], metrics);
    expect(failures).toEqual([]);
  });
});
