import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Scenario } from './config.js';
import { getRepoRoot } from './git.js';
import { runScenario, type PreparedRun } from './runner.js';
import type { RunMetrics, RunResult } from './types.js';

const CONTROLLED_FILES = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  '.claude/CLAUDE.md',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.mcp.json',
] as const;

const CONTROLLED_DIRS = ['.claude/rules', '.claude/hooks'] as const;
const CONFLICTING_ARGS = [
  '--bare',
  '--mcp-config',
  '--strict-mcp-config',
  '--plugin-dir',
  '--plugin-url',
  '--setting-sources',
  '--settings',
];

export interface ExperimentAggregate {
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  avgToolCalls: number;
  avgTotalTokens: number;
  avgDurationMs: number;
  avgCostUsd?: number;
}

export interface ExperimentRunSummary {
  passed: boolean;
  failures: string[];
  durationMs: number;
  metrics: RunMetrics;
}

export interface ExperimentVariantSummary {
  label: 'baseline' | 'candidate';
  configName: string;
  aggregate: ExperimentAggregate;
  runs: ExperimentRunSummary[];
}

export interface ExperimentResult {
  schemaVersion: 1;
  scenario: string;
  gitCommit: string;
  runsPerVariant: number;
  baseline: ExperimentVariantSummary;
  candidate: ExperimentVariantSummary;
  delta: {
    passRatePoints: number;
    avgToolCalls: number;
    avgTotalTokens: number;
    avgDurationMs: number;
    avgCostUsd?: number;
  };
  createdAt: string;
  artifactPath?: string;
}

export interface RunExperimentOptions {
  cwd?: string;
  runs?: number;
  executableOverride?: string;
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/');
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function assertVariantTreeSafe(root: string): Promise<void> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) throw new Error(`Configuration variant must not be a symbolic link: ${root}`);
  if (!rootInfo.isDirectory()) throw new Error(`Configuration variant is not a directory: ${root}`);

  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Configuration variant contains a symbolic link, which is refused for isolation: ${full}`);
      }
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(root);
}

async function listFilesRecursively(root: string, relativeRoot: string): Promise<string[]> {
  const absolute = path.join(root, relativeRoot);
  if (!(await exists(absolute))) return [];
  const output: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() || entry.isSymbolicLink()) output.push(normalizeRelative(path.relative(root, full)));
    }
  };

  await walk(absolute);
  return output;
}

async function collectControlledFiles(worktree: string): Promise<string[]> {
  const files = new Set<string>();
  for (const relative of CONTROLLED_FILES) {
    if (await exists(path.join(worktree, relative))) files.add(relative);
  }
  for (const relative of CONTROLLED_DIRS) {
    for (const file of await listFilesRecursively(worktree, relative)) files.add(file);
  }
  return [...files].sort();
}

async function hashFileOrNull(file: string): Promise<string | null> {
  try {
    const data = await readFile(file);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

async function validateJsonIfPresent(file: string, label: string): Promise<void> {
  if (!(await exists(file))) return;
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${file}`);
  }
}

export function assertExperimentCompatibleScenario(scenario: Scenario): void {
  for (const arg of scenario.claude.args) {
    if (CONFLICTING_ARGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      throw new Error(`Scenario claude.args contains ${arg}, which conflicts with configuration experiment isolation.`);
    }
  }
}

export async function validateConfigVariant(variantRoot: string): Promise<void> {
  const resolved = path.resolve(variantRoot);
  try {
    await assertVariantTreeSafe(resolved);
  } catch (error) {
    if (error instanceof Error && /symbolic link|not a directory/i.test(error.message)) throw error;
    throw new Error(`Configuration variant does not exist or cannot be inspected: ${variantRoot}`);
  }

  await validateJsonIfPresent(path.join(resolved, '.claude', 'settings.json'), '.claude/settings.json');
  await validateJsonIfPresent(path.join(resolved, '.claude', 'settings.local.json'), '.claude/settings.local.json');
  await validateJsonIfPresent(path.join(resolved, '.mcp.json'), '.mcp.json');
}

async function copyIfPresent(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

async function copyPlugins(variantRoot: string, runtimeRoot: string): Promise<string[]> {
  const source = path.join(variantRoot, 'plugins');
  if (!(await exists(source))) return [];
  const destination = path.join(runtimeRoot, 'plugins');
  await mkdir(destination, { recursive: true });
  const pluginPaths: string[] = [];

  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isDirectory() && !(entry.isFile() && entry.name.endsWith('.zip'))) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    await cp(from, to, { recursive: true, force: true });
    pluginPaths.push(to);
  }
  return pluginPaths.sort();
}

export async function prepareConfigVariant(worktree: string, variantRoot: string): Promise<PreparedRun> {
  const resolvedVariant = path.resolve(variantRoot);
  await validateConfigVariant(resolvedVariant);
  const before = new Set(await collectControlledFiles(worktree));

  for (const relative of CONTROLLED_FILES) await rm(path.join(worktree, relative), { recursive: true, force: true });
  for (const relative of CONTROLLED_DIRS) await rm(path.join(worktree, relative), { recursive: true, force: true });

  for (const relative of CONTROLLED_FILES) {
    await copyIfPresent(path.join(resolvedVariant, relative), path.join(worktree, relative));
  }
  for (const relative of CONTROLLED_DIRS) {
    await copyIfPresent(path.join(resolvedVariant, relative), path.join(worktree, relative));
  }

  const after = new Set(await collectControlledFiles(worktree));
  const allControlled = new Set([...before, ...after]);
  const fixtureState: Record<string, string | null> = {};
  for (const relative of allControlled) {
    fixtureState[relative] = await hashFileOrNull(path.join(worktree, relative));
  }

  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'claude-canary-config-'));
  const pluginDirs = await copyPlugins(resolvedVariant, runtimeRoot);
  const worktreeMcp = path.join(worktree, '.mcp.json');
  let mcpPath = worktreeMcp;
  if (!(await exists(worktreeMcp))) {
    mcpPath = path.join(runtimeRoot, 'empty-mcp.json');
    await writeFile(mcpPath, '{"mcpServers":{}}\n', 'utf8');
  }

  const extraClaudeArgs = [
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--mcp-config', mcpPath,
  ];
  for (const pluginDir of pluginDirs) extraClaudeArgs.push('--plugin-dir', pluginDir);

  return {
    extraClaudeArgs,
    env: {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
    fixtureState,
    cleanup: async () => rm(runtimeRoot, { recursive: true, force: true }),
  };
}

function summarizeRun(result: RunResult): ExperimentRunSummary {
  return {
    passed: result.passed,
    failures: result.failures,
    durationMs: result.durationMs,
    metrics: result.metrics,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateExperimentRuns(results: RunResult[]): ExperimentAggregate {
  if (results.length === 0) throw new Error('Cannot aggregate an empty experiment run set.');
  const costs = results.map((result) => result.metrics.costUsd).filter((value): value is number => value !== undefined);
  const passed = results.filter((result) => result.passed).length;
  return {
    runs: results.length,
    passed,
    failed: results.length - passed,
    passRate: passed / results.length,
    avgToolCalls: average(results.map((result) => result.metrics.toolCalls)),
    avgTotalTokens: average(results.map((result) => result.metrics.totalTokens)),
    avgDurationMs: average(results.map((result) => result.durationMs)),
    avgCostUsd: costs.length === results.length ? average(costs) : undefined,
  };
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'experiment';
}

async function writeExperimentArtifact(cwd: string, result: ExperimentResult): Promise<string> {
  const repoRoot = await getRepoRoot(cwd);
  const relative = path.join('.canary', 'results', `${result.createdAt.replace(/[:.]/g, '-')}-${safeSlug(result.scenario)}-experiment.json`);
  const absolute = path.join(repoRoot, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  const persisted = { ...result };
  delete persisted.artifactPath;
  await writeFile(absolute, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  return normalizeRelative(relative);
}

export async function runExperiment(
  scenario: Scenario,
  baselineConfig: string,
  candidateConfig: string,
  options: RunExperimentOptions = {},
): Promise<ExperimentResult> {
  assertExperimentCompatibleScenario(scenario);
  await validateConfigVariant(baselineConfig);
  await validateConfigVariant(candidateConfig);

  const runs = options.runs ?? 3;
  if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error('--runs must be an integer between 1 and 50.');
  const cwd = options.cwd ?? process.cwd();
  const baselineRuns: RunResult[] = [];
  const candidateRuns: RunResult[] = [];

  const runVariant = async (
    label: 'baseline' | 'candidate',
    configRoot: string,
    index: number,
  ): Promise<RunResult> => runScenario(scenario, {
    cwd,
    executableOverride: options.executableOverride,
    artifactLabel: `experiment-${label}-${index + 1}`,
    prepareWorktree: (worktree) => prepareConfigVariant(worktree, configRoot),
  });

  for (let index = 0; index < runs; index += 1) {
    if (index % 2 === 0) {
      baselineRuns.push(await runVariant('baseline', baselineConfig, index));
      candidateRuns.push(await runVariant('candidate', candidateConfig, index));
    } else {
      candidateRuns.push(await runVariant('candidate', candidateConfig, index));
      baselineRuns.push(await runVariant('baseline', baselineConfig, index));
    }
  }

  const baselineAggregate = aggregateExperimentRuns(baselineRuns);
  const candidateAggregate = aggregateExperimentRuns(candidateRuns);
  const baselineCost = baselineAggregate.avgCostUsd;
  const candidateCost = candidateAggregate.avgCostUsd;
  const result: ExperimentResult = {
    schemaVersion: 1,
    scenario: scenario.name,
    gitCommit: baselineRuns[0].gitCommit,
    runsPerVariant: runs,
    baseline: {
      label: 'baseline',
      configName: path.basename(path.resolve(baselineConfig)),
      aggregate: baselineAggregate,
      runs: baselineRuns.map(summarizeRun),
    },
    candidate: {
      label: 'candidate',
      configName: path.basename(path.resolve(candidateConfig)),
      aggregate: candidateAggregate,
      runs: candidateRuns.map(summarizeRun),
    },
    delta: {
      passRatePoints: (candidateAggregate.passRate - baselineAggregate.passRate) * 100,
      avgToolCalls: candidateAggregate.avgToolCalls - baselineAggregate.avgToolCalls,
      avgTotalTokens: candidateAggregate.avgTotalTokens - baselineAggregate.avgTotalTokens,
      avgDurationMs: candidateAggregate.avgDurationMs - baselineAggregate.avgDurationMs,
      avgCostUsd: baselineCost !== undefined && candidateCost !== undefined ? candidateCost - baselineCost : undefined,
    },
    createdAt: new Date().toISOString(),
  };

  result.artifactPath = await writeExperimentArtifact(cwd, result);
  return result;
}

function signed(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

function money(value?: number): string {
  return value === undefined ? 'n/a' : `$${value.toFixed(4)}`;
}

export function formatExperiment(result: ExperimentResult): string {
  const b = result.baseline.aggregate;
  const c = result.candidate.aggregate;
  const d = result.delta;
  const rows = [
    ['Pass rate', `${b.passed}/${b.runs} ${(b.passRate * 100).toFixed(1)}%`, `${c.passed}/${c.runs} ${(c.passRate * 100).toFixed(1)}%`, `${signed(d.passRatePoints)} pp`],
    ['Avg tool calls', b.avgToolCalls.toFixed(1), c.avgToolCalls.toFixed(1), signed(d.avgToolCalls)],
    ['Avg tokens', Math.round(b.avgTotalTokens).toLocaleString(), Math.round(c.avgTotalTokens).toLocaleString(), signed(d.avgTotalTokens, 0)],
    ['Avg cost', money(b.avgCostUsd), money(c.avgCostUsd), d.avgCostUsd === undefined ? 'n/a' : `${d.avgCostUsd > 0 ? '+' : ''}${money(d.avgCostUsd)}`],
    ['Avg duration', `${(b.avgDurationMs / 1000).toFixed(1)}s`, `${(c.avgDurationMs / 1000).toFixed(1)}s`, `${signed(d.avgDurationMs / 1000)}s`],
  ];
  const widths = [18, 18, 18, 14];
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join('');
  return [
    'Claude Code Canary — configuration experiment',
    '',
    `Scenario: ${result.scenario}`,
    `Runs per variant: ${result.runsPerVariant}`,
    `Baseline: ${result.baseline.configName}`,
    `Candidate: ${result.candidate.configName}`,
    '',
    line(['Metric', 'baseline', 'candidate', 'delta']),
    ...rows.map(line),
    '',
    `Result artifact: ${result.artifactPath ?? 'not written'}`,
  ].join('\n');
}
