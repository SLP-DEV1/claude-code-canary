import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadScenario, type Scenario } from './config.js';
import { fingerprintRun } from './fingerprint.js';
import { runScenario } from './runner.js';
import type { RunResult } from './types.js';

export type StabilityClassification = 'stable' | 'noisy' | 'flaky';
type StabilityPolicy = NonNullable<Scenario['stability']>;

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
  policyPassed: boolean;
  policyFailures: string[];
  fingerprintCounts: Record<string, number>;
  changedFileVariants: number;
  hookSequenceVariants: number;
  permissionSequenceVariants: number;
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

function classify(passRate: number, changedVariants: number, hookVariants: number, permissionVariants: number, tokenCv: number, toolCv: number): StabilityClassification {
  if (passRate === 1 && changedVariants <= 1 && hookVariants <= 1 && permissionVariants <= 1 && tokenCv <= 0.1 && toolCv <= 0.1) return 'stable';
  if (passRate >= 0.9 && changedVariants <= 2 && hookVariants <= 2 && permissionVariants <= 2) return 'noisy';
  return 'flaky';
}

function evaluatePolicy(result: Omit<FlakeResult, 'policyPassed' | 'policyFailures' | 'results' | 'jsonArtifactPath' | 'markdownArtifactPath'>, policy?: StabilityPolicy): string[] {
  if (!policy) return result.classification === 'flaky' ? ['Scenario classified as flaky.'] : [];
  const failures: string[] = [];
  if (result.passRate < policy.min_pass_rate) failures.push(`Pass rate ${result.passRate.toFixed(3)} is below min_pass_rate ${policy.min_pass_rate}.`);
  if (result.changedFileVariants > policy.max_changed_file_variants) failures.push(`Changed-file variants ${result.changedFileVariants} exceed ${policy.max_changed_file_variants}.`);
  if (policy.max_hook_sequence_variants !== undefined && result.hookSequenceVariants > policy.max_hook_sequence_variants) failures.push(`Hook sequence variants ${result.hookSequenceVariants} exceed ${policy.max_hook_sequence_variants}.`);
  if (policy.max_permission_sequence_variants !== undefined && result.permissionSequenceVariants > policy.max_permission_sequence_variants) failures.push(`Permission sequence variants ${result.permissionSequenceVariants} exceed ${policy.max_permission_sequence_variants}.`);
  if (policy.max_total_tokens_cv !== undefined && result.metrics.totalTokens.coefficientOfVariation > policy.max_total_tokens_cv) failures.push(`Total-token CV ${result.metrics.totalTokens.coefficientOfVariation.toFixed(3)} exceeds ${policy.max_total_tokens_cv}.`);
  if (policy.max_tool_calls_cv !== undefined && result.metrics.toolCalls.coefficientOfVariation > policy.max_tool_calls_cv) failures.push(`Tool-call CV ${result.metrics.toolCalls.coefficientOfVariation.toFixed(3)} exceeds ${policy.max_tool_calls_cv}.`);
  return failures;
}

export function summarizeFlakeRuns(scenario: string, results: RunResult[], policy?: StabilityPolicy): FlakeResult {
  const passedRuns = results.filter((result) => result.passed).length;
  const passRate = results.length ? passedRuns / results.length : 0;
  const fingerprintCounts: Record<string, number> = {};
  const assertionFailureFrequency: Record<string, number> = {};
  const variants = new Set<string>();
  const hookVariants = new Set<string>();
  const permissionVariants = new Set<string>();
  for (const result of results) {
    variants.add(JSON.stringify([...result.changedFiles].sort()));
    hookVariants.add(JSON.stringify(result.metrics.hookEventSequence ?? []));
    permissionVariants.add(JSON.stringify({
      requests: (result.metrics.permissionRequests ?? []).map((request) => [request.toolName ?? '', request.permissionMode ?? '']),
      denied: result.metrics.permissionDenied ?? 0,
    }));
    if (!result.passed) {
      const fingerprint = fingerprintRun(result).id;
      fingerprintCounts[fingerprint] = (fingerprintCounts[fingerprint] ?? 0) + 1;
    }
    for (const failure of result.failures) assertionFailureFrequency[failure] = (assertionFailureFrequency[failure] ?? 0) + 1;
  }
  const totalTokens = stats(results.map((result) => result.metrics.totalTokens));
  const toolCalls = stats(results.map((result) => result.metrics.toolCalls));
  const durationMs = stats(results.map((result) => result.durationMs));
  const base = {
    schemaVersion: 1 as const,
    scenario,
    createdAt: new Date().toISOString(),
    runs: results.length,
    passedRuns,
    passRate,
    classification: classify(passRate, variants.size, hookVariants.size, permissionVariants.size, totalTokens.coefficientOfVariation, toolCalls.coefficientOfVariation),
    fingerprintCounts,
    changedFileVariants: variants.size,
    hookSequenceVariants: hookVariants.size,
    permissionSequenceVariants: permissionVariants.size,
    assertionFailureFrequency,
    metrics: { totalTokens, toolCalls, durationMs },
  };
  const policyFailures = evaluatePolicy(base, policy);
  return { ...base, policyPassed: policyFailures.length === 0, policyFailures, results };
}

export function formatFlakeMarkdown(result: FlakeResult): string {
  const pct = (result.passRate * 100).toFixed(1);
  const lines = [
    `# Claude Canary flakiness — ${result.scenario}`,
    '',
    `**Classification:** ${result.classification}`,
    `**Policy:** ${result.policyPassed ? 'PASS' : 'FAIL'}`,
    `**Pass rate:** ${result.passedRuns}/${result.runs} (${pct}%)`,
    `**Changed-file variants:** ${result.changedFileVariants}`,
    `**Hook sequence variants:** ${result.hookSequenceVariants}`,
    `**Permission sequence variants:** ${result.permissionSequenceVariants}`,
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
  if (result.policyFailures.length) {
    lines.push('', '## Stability policy failures', '');
    for (const failure of result.policyFailures) lines.push(`- ${failure}`);
  }
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
  const summary = summarizeFlakeRuns(scenarioPath.replace(/\\/g, '/'), results, scenario.stability);
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
