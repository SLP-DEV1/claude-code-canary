import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import { evaluateComparisonRegressions } from '../src/regressions.js';
import type { RunMetrics, RunResult } from '../src/types.js';

function metrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    toolCalls: 4,
    inputTokens: 80,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 100,
    costUsd: 0.10,
    turns: 2,
    hookEvents: ['PostToolUse', 'PreToolUse'],
    hookEventSequence: ['PreToolUse', 'PostToolUse'],
    permissionPrompts: 0,
    permissionDenied: 0,
    permissionRequests: [],
    parseErrors: 0,
    ...overrides,
  };
}

function result(metricOverrides: Partial<RunMetrics> = {}): RunResult {
  return {
    schemaVersion: 1,
    scenario: 'compare-smoke',
    executable: 'claude',
    passed: true,
    failures: [],
    claudeExitCode: 0,
    claudeTimedOut: false,
    durationMs: 1000,
    changedFiles: [],
    setup: [],
    verification: [],
    metrics: metrics(metricOverrides),
    createdAt: '2026-08-27T00:00:00.000Z',
    gitCommit: '0000000000000000000000000000000000000000',
  };
}

describe('comparison regressions', () => {
  it('flags efficiency, permission and hook regressions even when both runs pass', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'compare-smoke',
      prompt: 'x',
      regressions: {
        max_total_tokens_increase_pct: 25,
        max_input_tokens_increase_pct: 25,
        max_output_tokens_increase_pct: 25,
        max_reported_cost_increase_pct: 20,
        max_tool_calls_increase_pct: 25,
        max_permission_prompts_increase: 0,
        max_permission_denied_increase: 0,
        require_same_hook_sequence: true,
      },
    });

    const baseline = result();
    const candidate = result({
      toolCalls: 6,
      inputTokens: 110,
      outputTokens: 30,
      totalTokens: 140,
      costUsd: 0.14,
      hookEventSequence: ['PreToolUse', 'PermissionRequest', 'PostToolUse'],
      permissionPrompts: 1,
      permissionDenied: 1,
      permissionRequests: [{ toolName: 'Read', toolUseId: 'tool-1', permissionMode: 'auto' }],
    });

    const regression = evaluateComparisonRegressions(scenario, baseline, candidate);
    expect(regression.passed).toBe(false);
    expect(regression.failures).toEqual(expect.arrayContaining([
      expect.stringMatching(/Total token regression/),
      expect.stringMatching(/Input token regression/),
      expect.stringMatching(/Output token regression/),
      expect.stringMatching(/Tool-call regression/),
      expect.stringMatching(/Reported cost regression/),
      expect.stringMatching(/Permission prompt regression/),
      expect.stringMatching(/Permission denied regression/),
      expect.stringMatching(/Hook sequence regression/),
    ]));
  });

  it('passes when the candidate stays within configured thresholds', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'compare-smoke',
      prompt: 'x',
      regressions: {
        max_total_tokens_increase_pct: 25,
        max_reported_cost_increase_pct: 25,
        max_tool_calls_increase_pct: 25,
        max_permission_prompts_increase: 0,
        require_same_hook_sequence: true,
      },
    });

    const regression = evaluateComparisonRegressions(
      scenario,
      result(),
      result({ toolCalls: 5, totalTokens: 120, costUsd: 0.12 }),
    );
    expect(regression).toEqual({ passed: true, failures: [] });
  });

  it('fails closed when reported cost comparison is configured but unavailable', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'compare-smoke',
      prompt: 'x',
      regressions: { max_reported_cost_increase_pct: 10 },
    });
    const baseline = result();
    const candidate = result();
    delete baseline.metrics.costUsd;

    const regression = evaluateComparisonRegressions(scenario, baseline, candidate);
    expect(regression.passed).toBe(false);
    expect(regression.failures).toEqual([expect.stringMatching(/cannot be evaluated/i)]);
  });

  it('treats growth from a zero baseline as a regression when a percentage threshold is configured', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'compare-smoke',
      prompt: 'x',
      regressions: { max_tool_calls_increase_pct: 100 },
    });

    const regression = evaluateComparisonRegressions(
      scenario,
      result({ toolCalls: 0 }),
      result({ toolCalls: 1 }),
    );
    expect(regression.passed).toBe(false);
    expect(regression.failures[0]).toMatch(/zero baseline/);
  });
});
