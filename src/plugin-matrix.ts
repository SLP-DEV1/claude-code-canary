import { cp, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Scenario } from './config.js';
import { getRepoRoot } from './git.js';
import {
  compareExactVersions,
  fetchPublishedClaudeVersions,
  publishedVersionsBetween,
} from './release-catalog.js';
import { runScenario, type PreparedRun } from './runner.js';
import { CANARY_VERSION } from './version.js';
import { installClaudeVersion, isExactVersion } from './versions.js';

const DEFAULT_RECENT_RELEASES = 10;
const MAX_MATRIX_RELEASES = 50;
const CONFLICTING_PLUGIN_ARGS = ['--plugin-dir', '--plugin-url'];

export interface PluginMatrixEntry {
  version: string;
  passed: boolean;
  failures: string[];
  durationMs: number;
  toolCalls: number;
  totalTokens: number;
  costUsd?: number;
}

export interface PluginMatrixResult {
  schemaVersion: 1;
  kind: 'plugin-compatibility-matrix';
  canaryVersion: string;
  scenario: string;
  pluginName: string;
  gitCommit: string;
  versions: string[];
  entries: PluginMatrixEntry[];
  compatible: number;
  incompatible: number;
  firstIncompatibleVersion?: string;
  createdAt: string;
  jsonArtifactPath?: string;
  markdownArtifactPath?: string;
}

export interface RunPluginMatrixOptions {
  cwd?: string;
  pluginPath: string;
  versions?: string[];
  from?: string;
  to?: string;
  last?: number;
  platform?: string;
  onStatus?: (message: string) => void;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'plugin';
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/');
}

export function selectRecentPublishedVersions(publishedVersions: Iterable<string>, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_MATRIX_RELEASES) {
    throw new Error(`--last must be an integer between 1 and ${MAX_MATRIX_RELEASES}.`);
  }
  const exact = [...new Set([...publishedVersions].filter(isExactVersion))].sort(compareExactVersions);
  return exact.slice(Math.max(0, exact.length - count));
}

export function validateExplicitVersions(versions: string[]): string[] {
  if (versions.length < 1) throw new Error('--versions requires at least one exact Claude Code version.');
  if (versions.length > MAX_MATRIX_RELEASES) throw new Error(`Plugin matrices are limited to ${MAX_MATRIX_RELEASES} releases.`);
  for (const version of versions) {
    if (!isExactVersion(version)) throw new Error(`Plugin matrix versions must be exact x.y.z releases; received ${JSON.stringify(version)}.`);
  }
  return [...new Set(versions)].sort(compareExactVersions);
}

export async function resolvePluginMatrixVersions(options: Pick<RunPluginMatrixOptions, 'versions' | 'from' | 'to' | 'last'>): Promise<string[]> {
  const usingExplicit = Boolean(options.versions?.length);
  const usingRange = options.from !== undefined || options.to !== undefined;
  const usingLast = options.last !== undefined;
  const modes = Number(usingExplicit) + Number(usingRange) + Number(usingLast);
  if (modes > 1) throw new Error('Use only one version selector: --versions, --from/--to, or --last.');

  if (usingExplicit) return validateExplicitVersions(options.versions ?? []);

  const published = await fetchPublishedClaudeVersions();
  if (usingRange) {
    if (!options.from || !options.to) throw new Error('--from and --to must be provided together.');
    const selected = publishedVersionsBetween(published, options.from, options.to);
    if (selected.length > MAX_MATRIX_RELEASES) {
      throw new Error(`Selected range contains ${selected.length} releases; plugin matrices are limited to ${MAX_MATRIX_RELEASES}. Narrow the range.`);
    }
    return selected;
  }

  return selectRecentPublishedVersions(published, options.last ?? DEFAULT_RECENT_RELEASES);
}

export function assertPluginMatrixCompatibleScenario(scenario: Scenario): void {
  for (const arg of scenario.claude.args) {
    if (CONFLICTING_PLUGIN_ARGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      throw new Error(`Scenario claude.args contains ${arg}, which conflicts with plugin matrix injection.`);
    }
  }
}

export async function assertPluginTreeSafe(pluginRoot: string): Promise<void> {
  const rootInfo = await lstat(pluginRoot);
  if (rootInfo.isSymbolicLink()) throw new Error(`Plugin path must not be a symbolic link: ${pluginRoot}`);
  if (!rootInfo.isDirectory()) throw new Error('Plugin path must be a directory.');

  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Plugin directory contains a symbolic link, which is refused for matrix isolation: ${full}`);
      }
      if (entry.isDirectory()) await walk(full);
    }
  };

  await walk(pluginRoot);
}

async function validatePluginPath(pluginPath: string): Promise<{ absolute: string; name: string }> {
  const absolute = path.resolve(pluginPath);
  try {
    await assertPluginTreeSafe(absolute);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('symbolic link') || error.message.includes('must be a directory'))) throw error;
    throw new Error(`Plugin path does not exist or cannot be inspected: ${pluginPath}`);
  }
  return { absolute, name: path.basename(absolute) || 'plugin' };
}

async function preparePluginCopy(pluginPath: string): Promise<PreparedRun> {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'claude-canary-plugin-'));
  const destination = path.join(runtimeRoot, path.basename(pluginPath));
  await cp(pluginPath, destination, { recursive: true, force: true });
  return {
    extraClaudeArgs: ['--plugin-dir', destination],
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    cleanup: async () => rm(runtimeRoot, { recursive: true, force: true }),
  };
}

export function formatPluginMatrixMarkdown(result: PluginMatrixResult): string {
  const rows = result.entries.map((entry) => {
    const resultCell = entry.passed ? '✅ Compatible' : '❌ Incompatible';
    const failure = entry.failures.length ? entry.failures.join('; ').replace(/\|/g, '\\|') : '';
    return `| \`${entry.version}\` | ${resultCell} | ${entry.toolCalls} | ${entry.totalTokens} | ${failure} |`;
  });

  const firstFailure = result.firstIncompatibleVersion
    ? `**First incompatible release in this matrix:** \`${result.firstIncompatibleVersion}\``
    : '**All tested releases are compatible.**';

  return `# Claude Code plugin compatibility matrix\n\n` +
    `Plugin: **${result.pluginName}**  \n` +
    `Scenario: **${result.scenario}**  \n` +
    `Git commit: \`${result.gitCommit}\`  \n` +
    `Generated by Claude Code Canary ${result.canaryVersion}.\n\n` +
    `${firstFailure}\n\n` +
    `| Claude Code | Result | Tool calls | Tokens | Failure |\n` +
    `| --- | --- | ---: | ---: | --- |\n` +
    `${rows.join('\n')}\n\n` +
    `Compatible: **${result.compatible}** · Incompatible: **${result.incompatible}**\n`;
}

async function writeMatrixArtifacts(cwd: string, result: PluginMatrixResult): Promise<{ json: string; markdown: string }> {
  const repoRoot = await getRepoRoot(cwd);
  const stamp = result.createdAt.replace(/[:.]/g, '-');
  const base = `${stamp}-${safeSlug(result.scenario)}-${safeSlug(result.pluginName)}-plugin-compat`;
  const jsonRelative = path.join('.canary', 'results', `${base}.json`);
  const markdownRelative = path.join('.canary', 'results', `${base}.md`);
  const jsonAbsolute = path.join(repoRoot, jsonRelative);
  const markdownAbsolute = path.join(repoRoot, markdownRelative);
  await mkdir(path.dirname(jsonAbsolute), { recursive: true });
  const persisted = { ...result };
  delete persisted.jsonArtifactPath;
  delete persisted.markdownArtifactPath;
  await writeFile(jsonAbsolute, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  await writeFile(markdownAbsolute, formatPluginMatrixMarkdown(result), 'utf8');
  return { json: normalizeRelative(jsonRelative), markdown: normalizeRelative(markdownRelative) };
}

export async function runPluginMatrix(scenario: Scenario, options: RunPluginMatrixOptions): Promise<PluginMatrixResult> {
  assertPluginMatrixCompatibleScenario(scenario);
  const plugin = await validatePluginPath(options.pluginPath);
  const versions = await resolvePluginMatrixVersions(options);
  if (versions.length === 0) throw new Error('No Claude Code releases selected for plugin compatibility matrix.');

  const cwd = options.cwd ?? process.cwd();
  const entries: PluginMatrixEntry[] = [];
  let gitCommit = '';

  for (const version of versions) {
    options.onStatus?.(`Testing plugin ${plugin.name} with Claude Code ${version}...`);
    const installed = await installClaudeVersion(version, {
      platform: options.platform,
      onStatus: options.onStatus,
    });
    const run = await runScenario(scenario, {
      cwd,
      executableOverride: installed.executablePath,
      artifactLabel: `plugin-${safeSlug(plugin.name)}-${version}`,
      prepareWorktree: () => preparePluginCopy(plugin.absolute),
    });
    gitCommit ||= run.gitCommit;
    entries.push({
      version: installed.version,
      passed: run.passed,
      failures: run.failures,
      durationMs: run.durationMs,
      toolCalls: run.metrics.toolCalls,
      totalTokens: run.metrics.totalTokens,
      costUsd: run.metrics.costUsd,
    });
  }

  const compatible = entries.filter((entry) => entry.passed).length;
  const firstIncompatibleVersion = entries.find((entry) => !entry.passed)?.version;
  const result: PluginMatrixResult = {
    schemaVersion: 1,
    kind: 'plugin-compatibility-matrix',
    canaryVersion: CANARY_VERSION,
    scenario: scenario.name,
    pluginName: plugin.name,
    gitCommit,
    versions: entries.map((entry) => entry.version),
    entries,
    compatible,
    incompatible: entries.length - compatible,
    firstIncompatibleVersion,
    createdAt: new Date().toISOString(),
  };

  const artifacts = await writeMatrixArtifacts(cwd, result);
  result.jsonArtifactPath = artifacts.json;
  result.markdownArtifactPath = artifacts.markdown;
  return result;
}
