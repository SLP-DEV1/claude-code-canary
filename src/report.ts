import type { RunResult } from './types.js';

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function cost(value: number | undefined): string {
  return value === undefined ? 'n/a' : `$${value.toFixed(4)}`;
}

function tokens(value: number): string {
  return value === 0 ? 'n/a' : value.toLocaleString('en-US');
}

export function formatRun(result: RunResult): string {
  const lines = [
    `Claude Code Canary — ${result.scenario}`,
    '',
    `Result:       ${result.passed ? 'PASS' : 'FAIL'}`,
    `Executable:   ${result.executable}`,
    `Tool calls:   ${result.metrics.toolCalls}`,
    `Total tokens: ${tokens(result.metrics.totalTokens)}`,
    `Cost:         ${cost(result.metrics.costUsd)}`,
    `Duration:     ${duration(result.durationMs)}`,
    `Changed:      ${result.changedFiles.length} file(s)`,
  ];

  if (result.failures.length > 0) {
    lines.push('', 'Failures:');
    for (const failure of result.failures) lines.push(`  - ${failure}`);
  }
  if (result.artifactPath) lines.push('', `Artifact: ${result.artifactPath}`);
  return lines.join('\n');
}

export function formatComparison(baseline: RunResult, candidate: RunResult): string {
  const rows: Array<[string, string, string]> = [
    ['Result', baseline.passed ? 'PASS' : 'FAIL', candidate.passed ? 'PASS' : 'FAIL'],
    ['Tool calls', String(baseline.metrics.toolCalls), String(candidate.metrics.toolCalls)],
    ['Total tokens', tokens(baseline.metrics.totalTokens), tokens(candidate.metrics.totalTokens)],
    ['Cost', cost(baseline.metrics.costUsd), cost(candidate.metrics.costUsd)],
    ['Duration', duration(baseline.durationMs), duration(candidate.durationMs)],
  ];

  const widths = [
    Math.max('Metric'.length, ...rows.map((row) => row[0].length)) + 2,
    Math.max('baseline'.length, ...rows.map((row) => row[1].length)) + 2,
  ];
  const lines = [
    'Claude Code Canary — compare',
    '',
    `${'Metric'.padEnd(widths[0])}${'baseline'.padEnd(widths[1])}candidate`,
    ...rows.map((row) => `${row[0].padEnd(widths[0])}${row[1].padEnd(widths[1])}${row[2]}`),
    '',
  ];

  if (baseline.passed && !candidate.passed) lines.push('Candidate regression detected.');
  else if (!baseline.passed && candidate.passed) lines.push('Candidate fixes the baseline failure.');
  else if (baseline.passed && candidate.passed) lines.push('Both runs passed.');
  else lines.push('Both runs failed. Compare failure details in the result artifacts.');

  return lines.join('\n');
}
