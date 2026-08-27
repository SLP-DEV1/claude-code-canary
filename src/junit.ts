import type { SuiteRunResult } from './suite.js';

function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function suiteToJUnit(result: SuiteRunResult): string {
  const failures = result.scenarios.filter((item) => !item.passed && !item.infrastructureError).length;
  const errors = result.scenarios.filter((item) => item.infrastructureError).length;
  const totalSeconds = result.scenarios.reduce((sum, item) => sum + ((item.result?.durationMs ?? 0) / 1000), 0);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${xmlEscape(result.suite)}" tests="${result.scenarios.length}" failures="${failures}" errors="${errors}" time="${totalSeconds.toFixed(3)}">`,
  ];
  for (const item of result.scenarios) {
    const seconds = ((item.result?.durationMs ?? 0) / 1000).toFixed(3);
    lines.push(`  <testcase classname="claude-code-canary" name="${xmlEscape(item.path)}" time="${seconds}">`);
    if (item.infrastructureError) {
      lines.push(`    <error type="infrastructure" message="${xmlEscape(item.infrastructureError)}">${xmlEscape(item.infrastructureError)}</error>`);
    } else if (!item.passed) {
      const failuresText = item.result?.failures.join('\n') || 'Scenario failed';
      lines.push(`    <failure type="regression" message="${xmlEscape(item.fingerprint?.id ?? 'regression')}">${xmlEscape(failuresText)}</failure>`);
    }
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>', '');
  return lines.join('\n');
}
