import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultBaselinePath, loadBaseline } from '../src/baseline.js';

describe('committed baselines', () => {
  it('uses a deterministic repository-local default path', () => {
    expect(defaultBaselinePath('/repo', 'Auth Refactor / CI')).toBe(path.join('/repo', '.canary', 'baselines', 'auth-refactor-ci.json'));
  });

  it('loads the v1 baseline snapshot contract', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canary-baseline-test-'));
    const file = path.join(dir, 'baseline.json');
    try {
      await writeFile(file, JSON.stringify({
        schemaVersion: 1,
        scenarioSchemaVersion: 1,
        scenario: 'demo',
        sourceScenario: '.canary/demo.canary.yml',
        scenarioHash: 'a'.repeat(64),
        createdAt: '2026-08-27T00:00:00.000Z',
        gitCommit: 'b'.repeat(40),
        executable: 'claude',
        durationMs: 1000,
        metrics: {
          toolCalls: 1,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 15,
          hookEvents: [],
          parseErrors: 0,
        },
      }), 'utf8');
      const baseline = await loadBaseline(file);
      expect(baseline.scenario).toBe('demo');
      expect(baseline.metrics.totalTokens).toBe(15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported or incomplete snapshots', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canary-baseline-test-'));
    const file = path.join(dir, 'bad.json');
    try {
      await writeFile(file, JSON.stringify({ schemaVersion: 2 }), 'utf8');
      await expect(loadBaseline(file)).rejects.toThrow(/unsupported baseline schema/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
