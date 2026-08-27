import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import {
  aggregateExperimentRuns,
  assertExperimentCompatibleScenario,
  prepareConfigVariant,
  validateConfigVariant,
} from '../src/experiment.js';
import { filterFixtureChanges } from '../src/runner.js';
import type { RunResult } from '../src/types.js';

const temporaryRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-experiment-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeRun(passed: boolean, toolCalls: number, totalTokens: number, durationMs: number, costUsd: number): RunResult {
  return {
    schemaVersion: 1,
    scenario: 'experiment',
    executable: 'claude',
    passed,
    failures: passed ? [] : ['failed'],
    claudeExitCode: passed ? 0 : 1,
    claudeTimedOut: false,
    durationMs,
    changedFiles: [],
    setup: [],
    verification: [],
    metrics: {
      toolCalls,
      inputTokens: totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens,
      costUsd,
      hookEvents: [],
      parseErrors: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    gitCommit: 'abc123',
  };
}

describe('configuration experiments', () => {
  it('aggregates pass rate and efficiency metrics', () => {
    const aggregate = aggregateExperimentRuns([
      fakeRun(true, 10, 100, 1000, 1),
      fakeRun(false, 20, 300, 3000, 3),
    ]);
    expect(aggregate.passRate).toBe(0.5);
    expect(aggregate.passed).toBe(1);
    expect(aggregate.failed).toBe(1);
    expect(aggregate.avgToolCalls).toBe(15);
    expect(aggregate.avgTotalTokens).toBe(200);
    expect(aggregate.avgDurationMs).toBe(2000);
    expect(aggregate.avgCostUsd).toBe(2);
  });

  it('rejects scenario flags that would defeat experiment isolation', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'conflict',
      prompt: 'test',
      claude: { args: ['--settings', './other.json'] },
    });
    expect(() => assertExperimentCompatibleScenario(scenario)).toThrow(/conflicts with configuration experiment isolation/i);
  });

  it('overlays controlled config, isolates MCP/plugins, and hides unchanged fixture edits', async () => {
    const root = await tempRoot();
    const worktree = path.join(root, 'worktree');
    const variant = path.join(root, 'variant');
    await mkdir(path.join(worktree, '.claude', 'rules'), { recursive: true });
    await mkdir(path.join(variant, '.claude', 'hooks'), { recursive: true });
    await mkdir(path.join(variant, 'plugins', 'demo', '.claude-plugin'), { recursive: true });

    await writeFile(path.join(worktree, 'CLAUDE.md'), 'old instructions\n');
    await writeFile(path.join(worktree, '.claude', 'rules', 'old.md'), 'old rule\n');
    await writeFile(path.join(variant, 'CLAUDE.md'), 'new instructions\n');
    await writeFile(path.join(variant, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Read"]}}\n');
    await writeFile(path.join(variant, '.claude', 'hooks', 'check.sh'), '#!/bin/sh\nexit 0\n');
    await writeFile(path.join(variant, '.mcp.json'), '{"mcpServers":{}}\n');
    await writeFile(path.join(variant, 'plugins', 'demo', '.claude-plugin', 'plugin.json'), '{"name":"demo","version":"1.0.0"}\n');

    const prepared = await prepareConfigVariant(worktree, variant);
    expect(await readFile(path.join(worktree, 'CLAUDE.md'), 'utf8')).toBe('new instructions\n');
    await expect(readFile(path.join(worktree, '.claude', 'rules', 'old.md'), 'utf8')).rejects.toThrow();
    expect(prepared.extraClaudeArgs).toContain('--setting-sources');
    expect(prepared.extraClaudeArgs).toContain('project,local');
    expect(prepared.extraClaudeArgs).toContain('--strict-mcp-config');
    expect(prepared.extraClaudeArgs?.filter((arg) => arg === '--plugin-dir')).toHaveLength(1);
    expect(prepared.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(prepared.fixtureState?.['.claude/rules/old.md']).toBeNull();

    const filtered = await filterFixtureChanges(
      worktree,
      ['CLAUDE.md', '.claude/rules/old.md', 'src/real-change.ts'],
      prepared.fixtureState,
    );
    expect(filtered).toEqual(['src/real-change.ts']);
    await prepared.cleanup?.();
  });

  it('fails validation before spending tokens when a variant JSON file is invalid', async () => {
    const root = await tempRoot();
    const variant = path.join(root, 'variant');
    await mkdir(path.join(variant, '.claude'), { recursive: true });
    await writeFile(path.join(variant, '.claude', 'settings.json'), '{broken');
    await expect(validateConfigVariant(variant)).rejects.toThrow(/invalid json/i);
  });

  it('refuses symlinks anywhere in a configuration variant', async () => {
    if (process.platform === 'win32') return;
    const root = await tempRoot();
    const variant = path.join(root, 'variant');
    await mkdir(path.join(variant, '.claude'), { recursive: true });
    const outside = path.join(root, 'outside.json');
    await writeFile(outside, '{"permissions":{}}\n');
    await symlink(outside, path.join(variant, '.claude', 'settings.json'));
    await expect(validateConfigVariant(variant)).rejects.toThrow(/symbolic link/i);
  });
});
