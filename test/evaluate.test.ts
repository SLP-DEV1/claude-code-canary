import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import { evaluateExpectations } from '../src/evaluate.js';
import type { RunMetrics } from '../src/types.js';

const metrics: RunMetrics = {
  toolCalls: 2,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 15,
  hookEvents: [],
  parseErrors: 0,
};

describe('deterministic expectations', () => {
  it('passes allow-list and content assertions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canary-eval-'));
    await writeFile(path.join(dir, 'proof.txt'), 'CANARY_OK\n');
    const scenario = parseScenario({
      version: 1,
      name: 'demo',
      prompt: 'x',
      expect: {
        changed_files: { allow: ['proof.txt'] },
        files_exist: ['proof.txt'],
        file_contains: [{ path: 'proof.txt', text: 'CANARY_OK' }],
      },
    });
    await expect(evaluateExpectations(scenario, dir, ['proof.txt'], metrics)).resolves.toEqual([]);
  });

  it('reports an unexpected changed file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canary-eval-'));
    const scenario = parseScenario({
      version: 1,
      name: 'demo',
      prompt: 'x',
      expect: { changed_files: { allow: ['src/**'] } },
    });
    const failures = await evaluateExpectations(scenario, dir, ['README.md'], metrics);
    expect(failures[0]).toMatch(/Unexpected changed file/);
  });

  it('checks required and forbidden Claude process output', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canary-eval-'));
    const scenario = parseScenario({
      version: 1,
      name: 'output-check',
      prompt: 'x',
      expect: {
        claude_output_contains: ['PLUGIN_OK'],
        claude_output_absent: ['Unknown command:'],
      },
    });

    await expect(evaluateExpectations(scenario, dir, [], metrics, 'PLUGIN_OK\n')).resolves.toEqual([]);
    const failures = await evaluateExpectations(scenario, dir, [], metrics, 'Unknown command: /demo:hello\n');
    expect(failures).toEqual(expect.arrayContaining([
      expect.stringMatching(/does not contain expected text.*PLUGIN_OK/),
      expect.stringMatching(/contains forbidden text.*Unknown command/),
    ]));
  });

  it('fails closed when a configured cost limit cannot be measured', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canary-eval-'));
    const scenario = parseScenario({
      version: 1,
      name: 'cost-check',
      prompt: 'x',
      limits: { max_cost_usd: 0.10 },
    });

    const missing = await evaluateExpectations(scenario, dir, [], metrics);
    expect(missing).toEqual([expect.stringMatching(/did not report total_cost_usd/i)]);

    const measured = { ...metrics, costUsd: 0.11 };
    const exceeded = await evaluateExpectations(scenario, dir, [], measured);
    expect(exceeded).toEqual([expect.stringMatching(/Cost limit exceeded/)]);
  });
});
