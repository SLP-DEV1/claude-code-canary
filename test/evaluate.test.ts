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
});
