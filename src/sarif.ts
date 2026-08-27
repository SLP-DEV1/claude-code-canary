import type { SuiteRunResult } from './suite.js';

export interface SarifLog {
  version: '2.1.0';
  $schema: string;
  runs: Array<{
    tool: { driver: { name: string; informationUri: string; rules: Array<{ id: string; shortDescription: { text: string } }> } };
    results: Array<{ ruleId: string; level: 'error' | 'warning'; message: { text: string }; properties?: Record<string, unknown> }>;
  }>;
}

export function suiteToSarif(result: SuiteRunResult): SarifLog {
  const rules = [
    { id: 'canary.regression', shortDescription: { text: 'Claude Code Canary regression' } },
    { id: 'canary.infrastructure', shortDescription: { text: 'Claude Code Canary infrastructure failure' } },
  ];
  const results = result.scenarios.flatMap((item) => {
    if (item.passed) return [];
    if (item.infrastructureError) {
      return [{
        ruleId: 'canary.infrastructure',
        level: 'error' as const,
        message: { text: `${item.path}: ${item.infrastructureError}` },
        properties: { scenario: item.path },
      }];
    }
    return [{
      ruleId: 'canary.regression',
      level: 'error' as const,
      message: { text: `${item.path}: ${item.result?.failures.join('; ') || 'Scenario failed'}` },
      properties: { scenario: item.path, fingerprint: item.fingerprint?.id },
    }];
  });
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'Claude Code Canary',
          informationUri: 'https://github.com/SLP-DEV1/claude-code-canary',
          rules,
        },
      },
      results,
    }],
  };
}
