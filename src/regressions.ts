import type { Scenario } from './config.js';
import type { RunResult } from './types.js';

export interface ComparisonRegressionResult {
  passed: boolean;
  failures: string[];
}

function percentIncrease(baseline: number, candidate: number): number | undefined {
  if (candidate <= baseline) return 0;
  if (baseline === 0) return undefined;
  return ((candidate - baseline) / baseline) * 100;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(4);
}

function evaluatePercentMetric(
  failures: string[],
  label: string,
  baseline: number,
  candidate: number,
  limit: number | undefined,
): void {
  if (limit === undefined || candidate <= baseline) return;
  const increase = percentIncrease(baseline, candidate);
  if (increase === undefined) {
    failures.push(`${label} regression: ${formatNumber(baseline)} -> ${formatNumber(candidate)} increased from a zero baseline; allowed increase is +${limit.toFixed(1)}%.`);
    return;
  }
  if (increase > limit) {
    failures.push(`${label} regression: ${formatNumber(baseline)} -> ${formatNumber(candidate)} (+${increase.toFixed(1)}%) exceeds allowed +${limit.toFixed(1)}%.`);
  }
}

function evaluateCost(
  failures: string[],
  baseline: number | undefined,
  candidate: number | undefined,
  limit: number | undefined,
): void {
  if (limit === undefined) return;
  if (baseline === undefined || candidate === undefined) {
    failures.push('Reported cost regression cannot be evaluated because baseline or candidate did not report total_cost_usd.');
    return;
  }
  evaluatePercentMetric(failures, 'Reported cost', baseline, candidate, limit);
}

function evaluateAbsoluteIncrease(
  failures: string[],
  label: string,
  baseline: number,
  candidate: number,
  allowedIncrease: number | undefined,
): void {
  if (allowedIncrease === undefined) return;
  const increase = candidate - baseline;
  if (increase > allowedIncrease) {
    failures.push(`${label} regression: ${baseline} -> ${candidate} (+${increase}) exceeds allowed increase +${allowedIncrease}.`);
  }
}

function firstSequenceDifference(baseline: string[], candidate: string[]): string {
  const length = Math.max(baseline.length, candidate.length);
  for (let index = 0; index < length; index += 1) {
    if (baseline[index] !== candidate[index]) {
      return `index ${index}: ${baseline[index] ?? '(end)'} -> ${candidate[index] ?? '(end)'}`;
    }
  }
  return 'unknown difference';
}

export function evaluateComparisonRegressions(
  scenario: Scenario,
  baseline: RunResult,
  candidate: RunResult,
): ComparisonRegressionResult {
  const thresholds = scenario.regressions;
  const failures: string[] = [];

  if (!thresholds) return { passed: true, failures };

  evaluatePercentMetric(
    failures,
    'Total token',
    baseline.metrics.totalTokens,
    candidate.metrics.totalTokens,
    thresholds.max_total_tokens_increase_pct,
  );
  evaluatePercentMetric(
    failures,
    'Input token',
    baseline.metrics.inputTokens,
    candidate.metrics.inputTokens,
    thresholds.max_input_tokens_increase_pct,
  );
  evaluatePercentMetric(
    failures,
    'Output token',
    baseline.metrics.outputTokens,
    candidate.metrics.outputTokens,
    thresholds.max_output_tokens_increase_pct,
  );
  evaluatePercentMetric(
    failures,
    'Tool-call',
    baseline.metrics.toolCalls,
    candidate.metrics.toolCalls,
    thresholds.max_tool_calls_increase_pct,
  );
  evaluateCost(
    failures,
    baseline.metrics.costUsd,
    candidate.metrics.costUsd,
    thresholds.max_reported_cost_increase_pct,
  );
  evaluateAbsoluteIncrease(
    failures,
    'Permission prompt',
    baseline.metrics.permissionPrompts ?? 0,
    candidate.metrics.permissionPrompts ?? 0,
    thresholds.max_permission_prompts_increase,
  );
  evaluateAbsoluteIncrease(
    failures,
    'Permission denied',
    baseline.metrics.permissionDenied ?? 0,
    candidate.metrics.permissionDenied ?? 0,
    thresholds.max_permission_denied_increase,
  );

  if (thresholds.require_same_hook_sequence) {
    const baselineSequence = baseline.metrics.hookEventSequence ?? [];
    const candidateSequence = candidate.metrics.hookEventSequence ?? [];
    const same = baselineSequence.length === candidateSequence.length
      && baselineSequence.every((event, index) => event === candidateSequence[index]);
    if (!same) {
      failures.push(`Hook sequence regression (${firstSequenceDifference(baselineSequence, candidateSequence)}).`);
    }
  }

  return { passed: failures.length === 0, failures };
}
