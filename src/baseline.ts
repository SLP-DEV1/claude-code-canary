import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadScenario, type Scenario } from './config.js';
import { formatComparisonMarkdown, type ComparisonReportSubject } from './comparison-markdown.js';
import { getRepoRoot } from './git.js';
import { evaluateComparisonRegressions, type ComparisonRegressionResult } from './regressions.js';
import { runScenario } from './runner.js';
import type { RunMetrics, RunResult } from './types.js';

export interface BaselineSnapshot {
  schemaVersion: 1;
  scenarioSchemaVersion: 1;
  scenario: string;
  sourceScenario: string;
  scenarioHash: string;
  createdAt: string;
  gitCommit: string;
  executable: string;
  durationMs: number;
  metrics: RunMetrics;
}

export interface BaselineUpdateOptions {
  cwd?: string;
  output?: string;
  executableOverride?: string;
}

export interface BaselineUpdateResult {
  baselinePath: string;
  snapshot: BaselineSnapshot;
  run: RunResult;
}

export interface BaselineCheckOptions {
  cwd?: string;
  baseline?: string;
  executableOverride?: string;
  gitRefOverride?: string;
}

export interface BaselineCheckResult {
  schemaVersion: 1;
  scenario: string;
  baselinePath: string;
  baseline: BaselineSnapshot;
  candidate: RunResult;
  regressions: ComparisonRegressionResult;
  passed: boolean;
  reportPath: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'scenario';
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function portableRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function isMetrics(value: unknown): value is RunMetrics {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<RunMetrics>;
  return [metrics.toolCalls, metrics.inputTokens, metrics.outputTokens, metrics.cacheReadTokens, metrics.cacheCreationTokens, metrics.totalTokens, metrics.parseErrors]
    .every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function parseBaselineSnapshot(value: unknown, baselinePath: string): BaselineSnapshot {
  if (!value || typeof value !== 'object') throw new Error(`${baselinePath} is not a Canary baseline object.`);
  const candidate = value as Partial<BaselineSnapshot>;
  if (candidate.schemaVersion !== 1 || candidate.scenarioSchemaVersion !== 1) {
    throw new Error(`${baselinePath} uses an unsupported baseline schema version.`);
  }
  for (const key of ['scenario', 'sourceScenario', 'scenarioHash', 'createdAt', 'gitCommit', 'executable'] as const) {
    if (typeof candidate[key] !== 'string' || candidate[key] === '') throw new Error(`${baselinePath} is missing ${key}.`);
  }
  if (typeof candidate.durationMs !== 'number' || !Number.isFinite(candidate.durationMs) || candidate.durationMs < 0) {
    throw new Error(`${baselinePath} has an invalid durationMs.`);
  }
  if (!isMetrics(candidate.metrics)) throw new Error(`${baselinePath} has invalid run metrics.`);
  return candidate as BaselineSnapshot;
}

async function scenarioContext(scenarioPath: string, cwd: string): Promise<{ scenario: Scenario; resolved: string; source: string; hash: string; repoRoot: string }> {
  const repoRoot = await getRepoRoot(cwd);
  const resolved = path.resolve(cwd, scenarioPath);
  const source = await readFile(resolved, 'utf8');
  const scenario = await loadScenario(resolved);
  return { scenario, resolved, source, hash: sha256(source), repoRoot };
}

export function defaultBaselinePath(repoRoot: string, scenarioName: string): string {
  return path.join(repoRoot, '.canary', 'baselines', `${slug(scenarioName)}.json`);
}

export async function updateBaseline(scenarioPath: string, options: BaselineUpdateOptions = {}): Promise<BaselineUpdateResult> {
  const cwd = options.cwd ?? process.cwd();
  const context = await scenarioContext(scenarioPath, cwd);
  const run = await runScenario(context.scenario, {
    cwd,
    executableOverride: options.executableOverride,
    artifactLabel: 'baseline-update',
  });
  if (!run.passed) {
    throw new Error(`Refusing to save a failing baseline for ${context.scenario.name}: ${run.failures.join('; ') || 'run failed'}`);
  }

  const snapshot: BaselineSnapshot = {
    schemaVersion: 1,
    scenarioSchemaVersion: 1,
    scenario: context.scenario.name,
    sourceScenario: portableRelative(context.repoRoot, context.resolved),
    scenarioHash: context.hash,
    createdAt: new Date().toISOString(),
    gitCommit: run.gitCommit,
    executable: run.executable,
    durationMs: run.durationMs,
    metrics: run.metrics,
  };
  const baselinePath = options.output ? path.resolve(cwd, options.output) : defaultBaselinePath(context.repoRoot, context.scenario.name);
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { baselinePath, snapshot, run };
}

export async function loadBaseline(file: string): Promise<BaselineSnapshot> {
  const text = await readFile(file, 'utf8');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${file} is not valid JSON.`); }
  return parseBaselineSnapshot(value, file);
}

function snapshotSubject(snapshot: BaselineSnapshot): ComparisonReportSubject {
  return {
    passed: true,
    failures: [],
    metrics: snapshot.metrics,
    durationMs: snapshot.durationMs,
    gitCommit: snapshot.gitCommit,
    executable: snapshot.executable,
  };
}

export async function checkBaseline(scenarioPath: string, options: BaselineCheckOptions = {}): Promise<BaselineCheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const context = await scenarioContext(scenarioPath, cwd);
  const baselinePath = options.baseline
    ? path.resolve(cwd, options.baseline)
    : defaultBaselinePath(context.repoRoot, context.scenario.name);
  const baseline = await loadBaseline(baselinePath);
  if (baseline.scenario !== context.scenario.name) {
    throw new Error(`Baseline scenario mismatch: ${baseline.scenario} != ${context.scenario.name}.`);
  }
  if (baseline.scenarioHash !== context.hash) {
    throw new Error(`Baseline ${portableRelative(context.repoRoot, baselinePath)} is stale because the scenario file changed. Run claude-canary baseline update ${scenarioPath}.`);
  }

  const candidate = await runScenario(context.scenario, {
    cwd,
    executableOverride: options.executableOverride,
    gitRefOverride: options.gitRefOverride ?? 'HEAD',
    allowDirtyWorkingTree: options.gitRefOverride !== undefined,
    artifactLabel: 'baseline-check',
  });
  const comparable = snapshotSubject(baseline);
  const regressions = evaluateComparisonRegressions(context.scenario, comparable, candidate);
  const passed = candidate.passed && regressions.passed;
  const markdown = formatComparisonMarkdown(comparable, candidate, regressions, {
    title: 'Claude Code Canary — Baseline Regression Report',
    baselineLabel: 'Saved baseline',
    candidateLabel: 'Current run',
    baselineRef: baseline.gitCommit.slice(0, 12),
    candidateRef: candidate.gitCommit.slice(0, 12),
  });
  const resultsDir = path.join(context.repoRoot, '.canary', 'results');
  await mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(resultsDir, `${stamp}-${slug(context.scenario.name)}-baseline-check.md`);
  await writeFile(reportPath, markdown, 'utf8');

  return {
    schemaVersion: 1,
    scenario: context.scenario.name,
    baselinePath,
    baseline,
    candidate,
    regressions,
    passed,
    reportPath,
  };
}
