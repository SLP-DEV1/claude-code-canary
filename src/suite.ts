import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import YAML from 'yaml';
import { z } from 'zod';
import { loadScenario } from './config.js';
import { clusterRunFailures, fingerprintRun, type FailureFingerprint } from './fingerprint.js';
import { runScenario } from './runner.js';
import type { RunResult } from './types.js';

const SuiteEntrySchema = z.object({
  path: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  affects: z.array(z.string().min(1)).default([]),
  always: z.boolean().default(false),
}).strict();

export const SuiteSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  include: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
  /** Tags applied to every scenario reached through include patterns. */
  tags: z.array(z.string().min(1)).default([]),
  scenarios: z.array(SuiteEntrySchema).default([]),
  concurrency: z.number().int().min(1).max(32).default(1),
  fail_fast: z.boolean().default(false),
  max_runs: z.number().int().min(1).max(10_000).default(500),
}).strict().refine((value) => value.include.length > 0 || value.scenarios.length > 0, {
  message: 'A suite needs at least one include pattern or scenarios entry.',
});

export type ScenarioSuite = z.infer<typeof SuiteSchema>;
export type ScenarioSuiteEntry = z.infer<typeof SuiteEntrySchema>;

export interface ResolvedSuiteScenario {
  path: string;
  tags: string[];
  affects: string[];
  always: boolean;
}

export interface SkippedSuiteScenario {
  path: string;
  reason: 'tag' | 'unaffected' | 'shard';
}

export interface SuiteSelection {
  discovered: ResolvedSuiteScenario[];
  selected: ResolvedSuiteScenario[];
  skipped: SkippedSuiteScenario[];
}

export interface SuiteRunOptions {
  cwd?: string;
  tag?: string;
  shard?: string;
  concurrency?: number;
  failFast?: boolean;
  maxRuns?: number;
  changedPaths?: string[];
  executableOverride?: string;
  gitRefOverride?: string;
  writeArtifacts?: boolean;
  artifactLabel?: string;
}

export interface SuiteScenarioResult {
  path: string;
  passed: boolean;
  result?: RunResult;
  fingerprint?: FailureFingerprint;
  infrastructureError?: string;
}

export interface SuiteRunResult {
  schemaVersion: 1;
  suite: string;
  suitePath: string;
  createdAt: string;
  passed: boolean;
  total: number;
  discoveredTotal: number;
  passedCount: number;
  failedCount: number;
  infrastructureFailedCount: number;
  skippedBySelection: number;
  skipped: SkippedSuiteScenario[];
  shard?: string;
  tag?: string;
  executable?: string;
  scenarios: SuiteScenarioResult[];
  failureClusters: ReturnType<typeof clusterRunFailures>;
  jsonArtifactPath?: string;
  markdownArtifactPath?: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'results']);

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function collectFiles(root: string, current = root, output: string[] = []): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (output.length > 20_000) throw new Error('Suite discovery exceeded 20,000 files; narrow the include patterns.');
      await collectFiles(root, absolute, output);
    } else if (entry.isFile()) {
      output.push(normalizeRelative(path.relative(root, absolute)));
    }
  }
  return output;
}

export function parseSuite(value: unknown): ScenarioSuite {
  const parsed = SuiteSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n');
  throw new Error(`Invalid Canary suite:\n${details}`);
}

export async function loadSuite(suitePath: string): Promise<ScenarioSuite> {
  let raw: string;
  try {
    raw = await readFile(suitePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read suite ${suitePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseSuite(YAML.parse(raw));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid Canary suite:')) throw error;
    throw new Error(`Could not parse YAML in ${suitePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseShard(value?: string): { index: number; total: number } | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new Error('--shard must use N/M, for example 2/4.');
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error('--shard must satisfy 1 <= N <= M.');
  }
  return { index, total };
}

function mergeEntry(target: Map<string, ResolvedSuiteScenario>, file: string, entry: { tags: string[]; affects: string[]; always: boolean }): void {
  const current = target.get(file) ?? { path: file, tags: [], affects: [], always: false };
  current.tags = [...new Set([...current.tags, ...entry.tags])].sort();
  current.affects = [...new Set([...current.affects, ...entry.affects])].sort();
  current.always = current.always || entry.always;
  target.set(file, current);
}

async function discoverSuiteCandidates(suite: ScenarioSuite, cwd: string): Promise<ResolvedSuiteScenario[]> {
  const files = await collectFiles(cwd);
  const selected = new Map<string, ResolvedSuiteScenario>();
  const excluded = (file: string) => suite.exclude.some((pattern) => minimatch(file, pattern, { dot: true }));

  for (const pattern of suite.include) {
    for (const file of files) {
      if (excluded(file) || !minimatch(file, pattern, { dot: true })) continue;
      mergeEntry(selected, file, { tags: suite.tags, affects: [], always: false });
    }
  }

  for (const entry of suite.scenarios) {
    for (const file of files) {
      if (excluded(file) || !minimatch(file, entry.path, { dot: true })) continue;
      mergeEntry(selected, file, entry);
    }
  }

  const candidates = [...selected.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const candidate of candidates) {
    const scenario = await loadScenario(path.resolve(cwd, candidate.path));
    candidate.tags = [...new Set([...candidate.tags, ...scenario.tags])].sort();
    candidate.affects = [...new Set([...candidate.affects, ...scenario.affects])].sort();
    candidate.always = candidate.always || scenario.always_run;
  }
  return candidates;
}

export async function explainSuiteSelection(
  suite: ScenarioSuite,
  options: Pick<SuiteRunOptions, 'cwd' | 'tag' | 'shard' | 'changedPaths'> = {},
): Promise<SuiteSelection> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const discovered = await discoverSuiteCandidates(suite, cwd);
  const skipped: SkippedSuiteScenario[] = [];
  let selected = [...discovered];

  if (options.tag) {
    const next: ResolvedSuiteScenario[] = [];
    for (const item of selected) {
      if (item.tags.includes(options.tag)) next.push(item);
      else skipped.push({ path: item.path, reason: 'tag' });
    }
    selected = next;
  }

  if (options.changedPaths) {
    const changed = options.changedPaths.map(normalizeRelative);
    const next: ResolvedSuiteScenario[] = [];
    for (const item of selected) {
      const affected = item.always || item.affects.length === 0 || changed.some((file) => item.affects.some((pattern) => minimatch(file, pattern, { dot: true })));
      if (affected) next.push(item);
      else skipped.push({ path: item.path, reason: 'unaffected' });
    }
    selected = next;
  }

  const shard = parseShard(options.shard);
  if (shard) {
    const next: ResolvedSuiteScenario[] = [];
    selected.forEach((item, index) => {
      if (index % shard.total === shard.index - 1) next.push(item);
      else skipped.push({ path: item.path, reason: 'shard' });
    });
    selected = next;
  }

  return {
    discovered,
    selected: selected.sort((a, b) => a.path.localeCompare(b.path)),
    skipped: skipped.sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason)),
  };
}

export async function resolveSuiteScenarios(
  suite: ScenarioSuite,
  options: Pick<SuiteRunOptions, 'cwd' | 'tag' | 'shard' | 'changedPaths'> = {},
): Promise<ResolvedSuiteScenario[]> {
  return (await explainSuiteSelection(suite, options)).selected;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'suite';
}

function formatSuiteMarkdown(result: SuiteRunResult): string {
  const lines = [
    `# Claude Canary suite — ${result.suite}`,
    '',
    `**Result:** ${result.passed ? 'PASS' : 'FAIL'}`,
    `**Scenarios:** ${result.passedCount}/${result.total} passed`,
    `**Discovered:** ${result.discoveredTotal}; skipped by selection/sharding: ${result.skippedBySelection}`,
  ];
  if (result.tag) lines.push(`**Tag:** \`${result.tag}\``);
  if (result.shard) lines.push(`**Shard:** \`${result.shard}\``);
  lines.push('', '| Scenario | Result | Fingerprint |', '| --- | --- | --- |');
  for (const item of result.scenarios) {
    lines.push(`| \`${item.path}\` | ${item.passed ? 'PASS' : item.infrastructureError ? 'INFRA' : 'FAIL'} | ${item.fingerprint ? `\`${item.fingerprint.id}\`` : ''} |`);
    if (item.infrastructureError) lines.push(`\n> ${item.path}: ${item.infrastructureError.replace(/\n/g, ' ')}`);
  }
  if (result.skipped.length) {
    lines.push('', '## Skipped', '');
    for (const item of result.skipped) lines.push(`- \`${item.path}\` — ${item.reason}`);
  }
  if (result.failureClusters.length) {
    lines.push('', '## Failure clusters', '');
    for (const cluster of result.failureClusters) {
      lines.push(`- \`${cluster.fingerprint.id}\` — ${cluster.count} failure(s): ${cluster.scenarios.join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function runSuite(suitePath: string, options: SuiteRunOptions = {}): Promise<SuiteRunResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const absoluteSuitePath = path.resolve(cwd, suitePath);
  const suite = await loadSuite(absoluteSuitePath);
  const selection = await explainSuiteSelection(suite, { cwd, tag: options.tag, changedPaths: options.changedPaths, shard: options.shard });
  const resolved = selection.selected;
  if (resolved.length === 0) throw new Error(`Suite ${suite.name} selected no scenarios.`);
  const maxRuns = options.maxRuns ?? suite.max_runs;
  if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new Error('Suite maxRuns must be a positive integer.');
  if (resolved.length > maxRuns) throw new Error(`Suite ${suite.name} selected ${resolved.length} scenarios, exceeding max run budget ${maxRuns}.`);

  const concurrency = Math.min(32, Math.max(1, options.concurrency ?? suite.concurrency));
  const failFast = options.failFast ?? suite.fail_fast;
  const results: SuiteScenarioResult[] = new Array(resolved.length);
  let cursor = 0;
  let stop = false;

  const worker = async () => {
    while (!stop) {
      const index = cursor++;
      if (index >= resolved.length) return;
      const item = resolved[index];
      try {
        const scenario = await loadScenario(path.resolve(cwd, item.path));
        const run = await runScenario(scenario, {
          cwd,
          executableOverride: options.executableOverride,
          gitRefOverride: options.gitRefOverride,
          artifactLabel: options.artifactLabel ? `${options.artifactLabel}-${index + 1}` : undefined,
        });
        results[index] = {
          path: item.path,
          passed: run.passed,
          result: run,
          fingerprint: run.passed ? undefined : fingerprintRun(run),
        };
        if (!run.passed && failFast) stop = true;
      } catch (error) {
        results[index] = {
          path: item.path,
          passed: false,
          infrastructureError: error instanceof Error ? error.message : String(error),
        };
        if (failFast) stop = true;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, resolved.length) }, () => worker()));
  const completed = results.filter((item): item is SuiteScenarioResult => Boolean(item));
  const runResults = completed.flatMap((item) => item.result ? [item.result] : []);
  const infrastructureFailedCount = completed.filter((item) => item.infrastructureError).length;
  const failedCount = completed.filter((item) => !item.passed).length;
  const result: SuiteRunResult = {
    schemaVersion: 1,
    suite: suite.name,
    suitePath: normalizeRelative(path.relative(cwd, absoluteSuitePath)),
    createdAt: new Date().toISOString(),
    passed: failedCount === 0 && completed.length === resolved.length,
    total: completed.length,
    discoveredTotal: selection.discovered.length,
    passedCount: completed.filter((item) => item.passed).length,
    failedCount,
    infrastructureFailedCount,
    skippedBySelection: selection.skipped.length,
    skipped: selection.skipped,
    shard: options.shard,
    tag: options.tag,
    executable: options.executableOverride,
    scenarios: completed,
    failureClusters: clusterRunFailures(runResults),
  };

  if (options.writeArtifacts !== false) {
    const outputDir = path.join(cwd, '.canary', 'results');
    await mkdir(outputDir, { recursive: true });
    const stamp = result.createdAt.replace(/[:.]/g, '-');
    const base = `${safeSlug(suite.name)}-${stamp}-suite`;
    result.jsonArtifactPath = path.join(outputDir, `${base}.json`);
    result.markdownArtifactPath = path.join(outputDir, `${base}.md`);
    await writeFile(result.jsonArtifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await writeFile(result.markdownArtifactPath, formatSuiteMarkdown(result), 'utf8');
  }
  return result;
}

export function combineSuiteResults(results: SuiteRunResult[]): SuiteRunResult {
  if (!results.length) throw new Error('At least one suite result is required.');
  const first = results[0];
  for (const result of results) {
    if (result.suite !== first.suite || result.suitePath !== first.suitePath) throw new Error('Cannot combine results from different suites.');
  }
  const scenariosByPath = new Map<string, SuiteScenarioResult>();
  for (const result of results) {
    for (const scenario of result.scenarios) {
      if (scenariosByPath.has(scenario.path)) throw new Error(`Duplicate scenario across suite shards: ${scenario.path}`);
      scenariosByPath.set(scenario.path, scenario);
    }
  }
  const scenarios = [...scenariosByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const runResults = scenarios.flatMap((item) => item.result ? [item.result] : []);
  const failedCount = scenarios.filter((item) => !item.passed).length;
  const infrastructureFailedCount = scenarios.filter((item) => item.infrastructureError).length;
  return {
    schemaVersion: 1,
    suite: first.suite,
    suitePath: first.suitePath,
    createdAt: new Date().toISOString(),
    passed: failedCount === 0,
    total: scenarios.length,
    discoveredTotal: Math.max(...results.map((result) => result.discoveredTotal)),
    passedCount: scenarios.filter((item) => item.passed).length,
    failedCount,
    infrastructureFailedCount,
    skippedBySelection: 0,
    skipped: [],
    scenarios,
    failureClusters: clusterRunFailures(runResults),
  };
}

export { formatSuiteMarkdown, parseShard };
