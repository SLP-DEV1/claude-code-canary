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

function repositoryRelative(root: string, file: string, label: string): string {
  const relative = path.relative(root, file);
  if (!relative || relative === '.') throw new Error(`${label} must be a file inside the Git repository.`);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must be inside the Git repository.`);
  }
  return relative.split(path.sep).join('/');
}

function nonnegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function optionalNonnegativeFinite(value: unknown): boolean {
  return value === undefined || nonnegativeFinite(value);
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}

function isMetrics(value: unknown): value is RunMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metrics = value as Partial<RunMetrics>;
  const requiredNumbers = [
    metrics.toolCalls,
    metrics.inputTokens,
    metrics.outputTokens,
    metrics.cacheReadTokens,
    metrics.cacheCreationTokens,
    metrics.totalTokens,
    metrics.parseErrors,
  ];
  if (!requiredNumbers.every(nonnegativeFinite)) return false;
  if (!Number.isInteger(metrics.toolCalls) || !Number.isInteger(metrics.parseErrors)) return false;
  if (!Array.isArray(metrics.hookEvents) || !metrics.hookEvents.every((entry) => typeof entry === 'string')) return false;
  if (!optionalStringArray(metrics.hookEventSequence)) return false;
  if (!optionalNonnegativeFinite(metrics.costUsd) || !optionalNonnegativeFinite(metrics.turns)) return false;
  if (metrics.permissionPrompts !== undefined && (!Number.isInteger(metrics.permissionPrompts) || metrics.permissionPrompts < 0)) return false;
  if (metrics.permissionDenied !== undefined && (!Number.isInteger(metrics.permissionDenied) || metrics.permissionDenied < 0)) return false;
  if (metrics.permissionRequests !== undefined) {
    if (!Array.isArray(metrics.permissionRequests)) return false;
    for (const request of metrics.permissionRequests) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
      for (const key of ['toolName', 'toolUseId', 'permissionMode'] as const) {
        if (request[key] !== undefined && typeof request[key] !== 'string') return false;
      }
    }
  }
  return true;
}

function parseBaselineSnapshot(value: unknown, baselinePath: string): BaselineSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${baselinePath} is not a Canary baseline object.`);
  const candidate = value as Partial<BaselineSnapshot>;
  if (candidate.schemaVersion !== 1 || candidate.scenarioSchemaVersion !== 1) {
    throw new Error(`${baselinePath} uses an unsupported baseline schema version.`);
  }
  for (const key of ['scenario', 'sourceScenario', 'createdAt', 'executable'] as const) {
    if (typeof candidate[key] !== 'string' || candidate[key] === '') throw new Error(`${baselinePath} is missing ${key}.`);
  }
  if (typeof candidate.scenarioHash !== 'string' || !/^[0-9a-f]{64}$/i.test(candidate.scenarioHash)) {
    throw new Error(`${baselinePath} has an invalid scenarioHash.`);
  }
  if (typeof candidate.gitCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(candidate.gitCommit)) {
    throw new Error(`${baselinePath} has an invalid gitCommit.`);
  }
  if (!nonnegativeFinite(candidate.durationMs)) throw new Error(`${baselinePath} has an invalid durationMs.`);
  if (!isMetrics(candidate.metrics)) throw new Error(`${baselinePath} has invalid run metrics.`);
  return candidate as BaselineSnapshot;
}

async function scenarioContext(scenarioPath: string, cwd: string): Promise<{ scenario: Scenario; resolved: string; source: string; hash: string; repoRoot: string; sourceScenario: string }> {
  const repoRoot = await getRepoRoot(cwd);
  const resolved = path.resolve(cwd, scenarioPath);
  const sourceScenario = repositoryRelative(repoRoot, resolved, 'Scenario');
  const source = await readFile(resolved, 'utf8');
  const scenario = await loadScenario(resolved);
  return { scenario, resolved, source, hash: sha256(source), repoRoot, sourceScenario };
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
    sourceScenario: context.sourceScenario,
    scenarioHash: context.hash,
    createdAt: new Date().toISOString(),
    gitCommit: run.gitCommit,
    executable: run.executable,
    durationMs: run.durationMs,
    metrics: run.metrics,
  };
  const baselinePath = options.output ? path.resolve(cwd, options.output) : defaultBaselinePath(context.repoRoot, context.scenario.name);
  repositoryRelative(context.repoRoot, baselinePath, 'Baseline output');
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
  repositoryRelative(context.repoRoot, baselinePath, 'Baseline');
  const baseline = await loadBaseline(baselinePath);
  if (baseline.scenario !== context.scenario.name) {
    throw new Error(`Baseline scenario mismatch: ${baseline.scenario} != ${context.scenario.name}.`);
  }
  if (baseline.sourceScenario !== context.sourceScenario) {
    throw new Error(`Baseline source mismatch: ${baseline.sourceScenario} != ${context.sourceScenario}. Refresh the baseline for this scenario path.`);
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
