import { describe, expect, it } from 'vitest';
import { formatComparison, formatRun } from '../src/report.js';
import type { RunResult } from '../src/types.js';

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    scenario: 'smoke',
    executable: 'claude',
    passed: true,
    failures: [],
    claudeExitCode: 0,
    claudeTimedOut: false,
    durationMs: 1000,
    changedFiles: [],
    setup: [],
    verification: [],
    metrics: {
      toolCalls: 1,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 15,
      costUsd: 0.1234,
      hookEvents: [],
      hookEventSequence: [],
      permissionPrompts: 0,
      permissionDenied: 0,
      permissionRequests: [],
      parseErrors: 0,
    },
    createdAt: '2026-08-27T00:00:00.000Z',
    gitCommit: '0000000000000000000000000000000000000000',
    ...overrides,
  };
}

describe('human reports', () => {
  it('labels upstream accounting as reported cost', () => {
    expect(formatRun(result())).toContain('Reported cost:      $0.1234');
    expect(formatComparison(result(), result())).toContain('Reported cost');
  });

  it('surfaces configured comparison regressions separately from standalone run failures', () => {
    const report = formatComparison(result(), result(), [
      'Total token regression: 100 -> 140 (+40.0%) exceeds allowed +25.0%.',
    ]);
    expect(report).toContain('Comparison regressions:');
    expect(report).toContain('Total token regression');
    expect(report).toContain('passed its standalone assertions');
  });
});
