import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadScenario } from './config.js';
import { fingerprintRun } from './fingerprint.js';
import { runScenario } from './runner.js';
import type { RunResult } from './types.js';

export type StabilityClassification = 'stable' | 'noisy' | 'flaky';

export interface FlakeOptions {
  cwd?: string;
  runs?: number;
  executableOverride?: string;
  writeArtifacts?: boolean;
}

export interface FlakeMetricStats {
  min: number;
  max: number;
  mean: number;
  coefficientOfVariation: number;
}

export interface FlakeResult {
  schemaVersion: 1;
  scenario: string;
  createdAt: string;
  runs: number;
  passedRuns: number;
  passRate: number;
  classification: StabilityClassification;
  fingerprintCounts: Record<string, number>;
  changedFileVariants: number;
  assertionFailureFrequency: Record<string, number>;
  metrics: {
    totalTokens: FlakeMetricStats;
    toolCalls: FlakeMetricStats;
    durationMs: FlakeMetricStats;
  };
  results: RunResult[];
  jsonArtifactPath?: string;
  markdownArtifactPath?: string;
}

function stats(values: number[]): FlakeMetricStats {
  if (!values.length) return { min: 0, max: 0, mean: 0, coefficientOfVariation: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const deviation = Math.sqrt(variance);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean,
    coefficientOfVariation: mean === 0 ? 0 : deviation / mean,
  };
}

function classify(passRate: number, changedVariants: number, tokenCv: number, toolCv: number): StabilityClassification {
  if (passRate === 1 && changedVariants <= 1 && tokenCv <= 0.1 && toolCv <= 0.1) return 'stable';
  if (passRate >= 0.9 && changedVariants <= 2) return 'noisy';
  return 'flaky';
}

export function summarizeFlakeRuns(scenario: string, results: RunResult[]): FlakeResult {
  const passedRuns = results.filter((result) => result.passed).length;
  const passRate = results.length ? passedRuns / results.length : 0;
  const fingerprintCounts: Record<string, number> = {};
  const assertionFailureFrequency: Record<string, number> = {};
  const variants = new Set<string>();
  for (const result of results) {
    variants.add(JSON.stringify([...result.changedFiles].sort()));
    if (!result.passed) {
      const fingerprint = fingerprintRun(result).id;
      fingerprintCounts[fingerprint] = (fingerprintCounts[fingerprint] ?? 0) + 1;
    }
    for (const failure of result.failures) assertionFailureFrequency[failure] = (assertionFailureFrequency[failure] ?? 0) + 1;
  }
  const totalTokens = stats(results.map((result) => result.metrics.totalTokens));
  const toolCalls = stats(results.map((result) => result.metrics.toolCalls));
  const durationMs = stats(results.map((result) => result.durationMs));
  return {
    schemaVersion: 1,
    scenario,
    createdAt: new Date().toISOString(),
    runs: results.length,
    passedRuns,
    passRate,
    classification: classify(passRate, variants.size, totalTokens.coefficientOfVariation, toolCalls.coefficientOfVariation),
    fingerprintCounts,
    changedFileVariants: variants.size,
    assertionFailureFrequency,
    metrics: { totalTokens, toolCalls, durationMs },
    results,
  };
}

export function formatFlakeMarkdown(result: FlakeResult): string {
  const pct = (result.passRate * 100).toFixed(1);
  const lines = [
    `# Claude Canary flakiness — ${result.scenario}`,
    '',
    `**Classification:** ${result.classification}`,
    `**Pass rate:** ${result.passedRuns}/${result.runs} (${pct}%)`,
    `**Changed-file variants:** ${result.changedFileVariants}`,
    '',
    '| Metric | Min | Mean | Max | CV |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  const rows: Array<[string, FlakeMetricStats]> = [
    ['Total tokens', result.metrics.totalTokens],
    ['Tool calls', result.metrics.toolCalls],
    ['Duration ms', result.metrics.durationMs],
  ];
  for (const [name, value] of rows) lines.push(`| ${name} | ${value.min.toFixed(1)} | ${value.mean.toFixed(1)} | ${value.max.toFixed(1)} | ${value.coefficientOfVariation.toFixed(3)} |`);
  if (Object.keys(result.fingerprintCounts).length) {
    lines.push('', '## Failure fingerprints', '');
    for (const [id, count] of Object.entries(result.fingerprintCounts).sort()) lines.push(`- \`${id}\`: ${count}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function analyzeFlakiness(scenarioPath: string, options: FlakeOptions = {}): Promise<FlakeResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runs = options.runs ?? 10;
  if (!Number.isInteger(runs) || runs < 2 || runs > 100) throw new Error('Flakiness runs must be an integer between 2 and 100.');
  const scenario = await loadScenario(path.resolve(cwd, scenarioPath));
  const results: RunResult[] = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(await runScenario(scenario, {
      cwd,
      executableOverride: options.executableOverride,
      artifactLabel: `flake-${index + 1}`,
    }));
  }
  const summary = summarizeFlakeRuns(scenarioPath.replace(/\\/g, '/'), results);
  if (options.writeArtifacts !== false) {
    const outputDir = path.join(cwd, '.canary', 'results');
    await mkdir(outputDir, { recursive: true });
    const stamp = summary.createdAt.replace(/[:.]/g, '-');
    const base = `${path.basename(scenarioPath).replace(/[^A-Za-z0-9._-]/g, '-')}-${stamp}-flake`;
    summary.jsonArtifactPath = path.join(outputDir, `${base}.json`);
    summary.markdownArtifactPath = path.join(outputDir, `${base}.md`);
    await writeFile(summary.jsonArtifactPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(summary.markdownArtifactPath, formatFlakeMarkdown(summary), 'utf8');
  }
  return summary;
}
