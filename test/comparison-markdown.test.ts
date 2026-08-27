import { describe, expect, it } from 'vitest';
import { formatComparisonMarkdown, type ComparisonReportSubject } from '../src/comparison-markdown.js';

function subject(overrides: Partial<ComparisonReportSubject['metrics']> = {}): ComparisonReportSubject {
  return {
    passed: true,
    failures: [],
    durationMs: 1000,
    gitCommit: 'a'.repeat(40),
    executable: 'claude',
    metrics: {
      toolCalls: 4,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 120,
      hookEvents: [],
      hookEventSequence: ['PreToolUse', 'PostToolUse'],
      permissionPrompts: 0,
      permissionDenied: 0,
      parseErrors: 0,
      ...overrides,
    },
  };
}

describe('comparison Markdown report', () => {
  it('shows deltas and configured regression failures', () => {
    const markdown = formatComparisonMarkdown(
      subject(),
      subject({ totalTokens: 180, toolCalls: 6, permissionPrompts: 1 }),
      {
        passed: false,
        failures: [
          'Total token regression: 120 -> 180 (+50.0%) exceeds allowed +25.0%.',
          'Permission prompt regression: 0 -> 1 (+1) exceeds allowed increase +0.',
        ],
      },
      { title: 'PR Regression Report', baselineLabel: 'Base', candidateLabel: 'PR', baselineRef: 'main', candidateRef: 'HEAD' },
    );

    expect(markdown).toContain('❌ REGRESSION');
    expect(markdown).toContain('| Total tokens | 120 | 180 | +50.0% | ❌ |');
    expect(markdown).toContain('| Permission prompts | 0 | 1 | +1 | ❌ |');
    expect(markdown).toContain('`main` → `HEAD`');
  });

  it('marks an unchanged hook trace as healthy', () => {
    const markdown = formatComparisonMarkdown(subject(), subject(), { passed: true, failures: [] });
    expect(markdown).toContain('| Hook sequence | 2 event(s) | 2 event(s) | unchanged | ✅ |');
    expect(markdown).toContain('✅ PASS');
  });
});
