import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fingerprintRun } from './fingerprint.js';
import { runSuite, type SuiteRunResult } from './suite.js';

export interface SuiteFlakeResult {
  schemaVersion: 1;
  suitePath: string;
  createdAt: string;
  runs: number;
  passRate: number;
  classification: 'stable' | 'noisy' | 'flaky';
  scenarioStability: Array<{
    path: string;
    appearances: number;
    passes: number;
    passRate: number;
    fingerprintCounts: Record<string, number>;
  }>;
  results: SuiteRunResult[];
  jsonArtifactPath?: string;
  markdownArtifactPath?: string;
}

function classify(passRate: number, scenarios: SuiteFlakeResult['scenarioStability']): SuiteFlakeResult['classification'] {
  const worst = scenarios.reduce((minimum, item) => Math.min(minimum, item.passRate), 1);
  if (passRate === 1 && worst === 1) return 'stable';
  if (passRate >= 0.9 && worst >= 0.9) return 'noisy';
  return 'flaky';
}

export function summarizeSuiteFlakiness(suitePath: string, results: SuiteRunResult[]): SuiteFlakeResult {
  const byScenario = new Map<string, { appearances: number; passes: number; fingerprintCounts: Record<string, number> }>();
  for (const run of results) {
    for (const item of run.scenarios) {
      const current = byScenario.get(item.path) ?? { appearances: 0, passes: 0, fingerprintCounts: {} };
      current.appearances += 1;
      if (item.passed) current.passes += 1;
      else if (item.fingerprint) current.fingerprintCounts[item.fingerprint.id] = (current.fingerprintCounts[item.fingerprint.id] ?? 0) + 1;
      else if (item.result) {
        const id = fingerprintRun(item.result).id;
        current.fingerprintCounts[id] = (current.fingerprintCounts[id] ?? 0) + 1;
      }
      byScenario.set(item.path, current);
    }
  }
  const scenarioStability = [...byScenario.entries()].map(([scenarioPath, value]) => ({
    path: scenarioPath,
    appearances: value.appearances,
    passes: value.passes,
    passRate: value.appearances ? value.passes / value.appearances : 0,
    fingerprintCounts: value.fingerprintCounts,
  })).sort((a, b) => a.path.localeCompare(b.path));
  const passRate = results.length ? results.filter((run) => run.passed).length / results.length : 0;
  return {
    schemaVersion: 1,
    suitePath,
    createdAt: new Date().toISOString(),
    runs: results.length,
    passRate,
    classification: classify(passRate, scenarioStability),
    scenarioStability,
    results,
  };
}

export function formatSuiteFlakeMarkdown(result: SuiteFlakeResult): string {
  const lines = [
    `# Claude Canary suite flakiness — ${result.suitePath}`,
    '',
    `**Classification:** ${result.classification}`,
    `**Suite pass rate:** ${(result.passRate * 100).toFixed(1)}%`,
    '',
    '| Scenario | Pass rate | Fingerprints |',
    '| --- | ---: | --- |',
  ];
  for (const item of result.scenarioStability) {
    const fps = Object.entries(item.fingerprintCounts).map(([id, count]) => `${id}×${count}`).join(', ');
    lines.push(`| \`${item.path}\` | ${(item.passRate * 100).toFixed(1)}% | ${fps} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function analyzeSuiteFlakiness(
  suitePath: string,
  options: { cwd?: string; runs?: number; executableOverride?: string; concurrency?: number; writeArtifacts?: boolean } = {},
): Promise<SuiteFlakeResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runs = options.runs ?? 5;
  if (!Number.isInteger(runs) || runs < 2 || runs > 30) throw new Error('Suite flakiness runs must be an integer between 2 and 30.');
  const results: SuiteRunResult[] = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(await runSuite(suitePath, {
      cwd,
      executableOverride: options.executableOverride,
      concurrency: options.concurrency,
      writeArtifacts: false,
      artifactLabel: `suite-flake-${index + 1}`,
    }));
  }
  const summary = summarizeSuiteFlakiness(suitePath.replace(/\\/g, '/'), results);
  if (options.writeArtifacts !== false) {
    const outputDir = path.join(cwd, '.canary', 'results');
    await mkdir(outputDir, { recursive: true });
    const stamp = summary.createdAt.replace(/[:.]/g, '-');
    summary.jsonArtifactPath = path.join(outputDir, `suite-flake-${stamp}.json`);
    summary.markdownArtifactPath = path.join(outputDir, `suite-flake-${stamp}.md`);
    await writeFile(summary.jsonArtifactPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(summary.markdownArtifactPath, formatSuiteFlakeMarkdown(summary), 'utf8');
  }
  return summary;
}
