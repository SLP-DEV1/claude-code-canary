import type { ComparisonRegressionResult } from './regressions.js';
import type { RunMetrics } from './types.js';

export interface ComparisonReportSubject {
  passed: boolean;
  failures: string[];
  metrics: RunMetrics;
  durationMs: number;
  gitCommit: string;
  executable: string;
}

export interface ComparisonMarkdownOptions {
  title?: string;
  baselineLabel?: string;
  candidateLabel?: string;
  baselineRef?: string;
  candidateRef?: string;
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

function cost(value: number | undefined): string {
  return value === undefined ? 'n/a' : `$${value.toFixed(4)}`;
}

function percentDelta(baseline: number, candidate: number): string {
  if (candidate === baseline) return '0.0%';
  if (baseline === 0) return candidate > 0 ? '+∞' : '0.0%';
  const value = ((candidate - baseline) / baseline) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function absoluteDelta(baseline: number, candidate: number): string {
  const value = candidate - baseline;
  return `${value >= 0 ? '+' : ''}${value}`;
}

function costDelta(baseline: number | undefined, candidate: number | undefined): string {
  if (baseline === undefined || candidate === undefined) return 'n/a';
  return percentDelta(baseline, candidate);
}

function duration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

function metricStatus(regressions: string[], prefix: string): string {
  return regressions.some((failure) => failure.startsWith(prefix)) ? '❌' : '✅';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatComparisonMarkdown(
  baseline: ComparisonReportSubject,
  candidate: ComparisonReportSubject,
  regressions: ComparisonRegressionResult,
  options: ComparisonMarkdownOptions = {},
): string {
  const baselineLabel = options.baselineLabel ?? 'Baseline';
  const candidateLabel = options.candidateLabel ?? 'Candidate';
  const passed = candidate.passed && regressions.passed;
  const baseHooks = baseline.metrics.hookEventSequence ?? [];
  const candidateHooks = candidate.metrics.hookEventSequence ?? [];
  const sameHooks = baseHooks.length === candidateHooks.length && baseHooks.every((value, index) => value === candidateHooks[index]);
  const rows: Array<[string, string, string, string, string]> = [
    ['Functional', baseline.passed ? 'PASS' : 'FAIL', candidate.passed ? 'PASS' : 'FAIL', candidate.passed ? 'pass' : 'fail', candidate.passed ? '✅' : '❌'],
    ['Total tokens', number(baseline.metrics.totalTokens), number(candidate.metrics.totalTokens), percentDelta(baseline.metrics.totalTokens, candidate.metrics.totalTokens), metricStatus(regressions.failures, 'Total token regression')],
    ['Input tokens', number(baseline.metrics.inputTokens), number(candidate.metrics.inputTokens), percentDelta(baseline.metrics.inputTokens, candidate.metrics.inputTokens), metricStatus(regressions.failures, 'Input token regression')],
    ['Output tokens', number(baseline.metrics.outputTokens), number(candidate.metrics.outputTokens), percentDelta(baseline.metrics.outputTokens, candidate.metrics.outputTokens), metricStatus(regressions.failures, 'Output token regression')],
    ['Tool calls', number(baseline.metrics.toolCalls), number(candidate.metrics.toolCalls), percentDelta(baseline.metrics.toolCalls, candidate.metrics.toolCalls), metricStatus(regressions.failures, 'Tool-call regression')],
    ['Reported cost', cost(baseline.metrics.costUsd), cost(candidate.metrics.costUsd), costDelta(baseline.metrics.costUsd, candidate.metrics.costUsd), metricStatus(regressions.failures, 'Reported cost regression')],
    ['Permission prompts', String(baseline.metrics.permissionPrompts ?? 0), String(candidate.metrics.permissionPrompts ?? 0), absoluteDelta(baseline.metrics.permissionPrompts ?? 0, candidate.metrics.permissionPrompts ?? 0), metricStatus(regressions.failures, 'Permission prompt regression')],
    ['Permission denied', String(baseline.metrics.permissionDenied ?? 0), String(candidate.metrics.permissionDenied ?? 0), absoluteDelta(baseline.metrics.permissionDenied ?? 0, candidate.metrics.permissionDenied ?? 0), metricStatus(regressions.failures, 'Permission denied regression')],
    ['Hook sequence', `${baseHooks.length} event(s)`, `${candidateHooks.length} event(s)`, sameHooks ? 'unchanged' : 'changed', metricStatus(regressions.failures, 'Hook sequence regression')],
    ['Duration', duration(baseline.durationMs), duration(candidate.durationMs), percentDelta(baseline.durationMs, candidate.durationMs), 'ℹ️'],
  ];

  const lines = [
    `## ${options.title ?? 'Claude Code Canary — Regression Report'}`,
    '',
    `**Result:** ${passed ? '✅ PASS' : '❌ REGRESSION'}`,
  ];
  if (options.baselineRef || options.candidateRef) {
    lines.push(`**Refs:** \`${escapeCell(options.baselineRef ?? baseline.gitCommit.slice(0, 12))}\` → \`${escapeCell(options.candidateRef ?? candidate.gitCommit.slice(0, 12))}\``);
  }
  lines.push('', `| Metric | ${escapeCell(baselineLabel)} | ${escapeCell(candidateLabel)} | Delta | Status |`, '| --- | ---: | ---: | ---: | :---: |');
  for (const row of rows) lines.push(`| ${row.map(escapeCell).join(' | ')} |`);

  if (regressions.failures.length > 0) {
    lines.push('', '### Regression signals', '');
    for (const failure of regressions.failures) lines.push(`- ❌ ${failure}`);
  }
  if (candidate.failures.length > 0) {
    lines.push('', '### Candidate failures', '');
    for (const failure of candidate.failures) lines.push(`- ❌ ${failure}`);
  }
  lines.push('', `<sub>Canary compares deterministic task assertions plus configured efficiency, permission and lifecycle thresholds. Reported cost is upstream metadata and may be synthetic behind proxies/local models.</sub>`);
  return `${lines.join('\n')}\n`;
}
