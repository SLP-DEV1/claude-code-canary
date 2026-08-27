import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadScenario, type Scenario } from './config.js';
import { getRepoRoot } from './git.js';
import { discoverPlugin, type PluginDiscovery } from './plugin-init.js';
import {
  resolvePluginMatrixVersions,
  runPluginMatrix,
  type PluginMatrixEntry,
  type PluginMatrixResult,
  type RunPluginMatrixOptions,
} from './plugin-matrix.js';
import { CANARY_VERSION } from './version.js';

const PLUGIN_INIT_MARKER = '.claude-canary-plugin-init';
const DEFAULT_MAX_SUITE_RUNS = 200;
const HARD_MAX_SUITE_RUNS = 1000;
const MAX_SUITE_SCENARIOS = 100;

export type PluginSuiteScenarioKind = 'load' | 'command' | 'agent' | 'skill' | 'hook' | 'mcp' | 'lsp' | 'custom';

export interface PluginSuiteScenario {
  id: string;
  kind: PluginSuiteScenarioKind;
  component?: string;
  path: string;
  scenario: Scenario;
}

export interface PluginSuiteScenarioResult {
  id: string;
  kind: PluginSuiteScenarioKind;
  component?: string;
  path: string;
  scenario: string;
  entries: PluginMatrixEntry[];
  compatible: number;
  incompatible: number;
  firstIncompatibleVersion?: string;
}

export interface PluginSuiteFailure {
  scenarioId: string;
  scenario: string;
  path: string;
  failures: string[];
}

export interface PluginSuiteVersionResult {
  version: string;
  passed: boolean;
  passedScenarios: number;
  failedScenarios: number;
  durationMs: number;
  toolCalls: number;
  totalTokens: number;
  costUsd?: number;
  failures: PluginSuiteFailure[];
}

export interface PluginSuiteResult {
  schemaVersion: 1;
  kind: 'plugin-compatibility-suite';
  canaryVersion: string;
  pluginName: string;
  suiteDir: string;
  gitCommit: string;
  versions: string[];
  scenarios: PluginSuiteScenarioResult[];
  versionResults: PluginSuiteVersionResult[];
  totalRuns: number;
  compatibleRuns: number;
  incompatibleRuns: number;
  compatibleVersions: number;
  incompatibleVersions: number;
  firstIncompatibleVersion?: string;
  createdAt: string;
  jsonArtifactPath?: string;
  markdownArtifactPath?: string;
}

export interface RunPluginSuiteOptions extends Omit<RunPluginMatrixOptions, 'pluginPath' | 'versions' | 'onStatus' | 'writeArtifacts'> {
  pluginPath: string;
  suiteDir?: string;
  versions?: string[];
  maxRuns?: number;
  writeArtifacts?: boolean;
  onStatus?: (message: string) => void;
  matrixRunner?: typeof runPluginMatrix;
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/');
}

function safeSlug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  let start = 0;
  while (start < normalized.length && normalized.charCodeAt(start) === 45) start += 1;
  let end = normalized.length;
  while (end > start && normalized.charCodeAt(end - 1) === 45) end -= 1;
  return normalized.slice(start, Math.min(end, start + 80)) || 'component';
}

function scenarioKindFromFile(fileName: string): { kind: PluginSuiteScenarioKind; component?: string } {
  const base = fileName.replace(/\.canary\.ya?ml$/i, '');
  if (base === 'load') return { kind: 'load' };
  for (const kind of ['command', 'agent', 'skill', 'hook', 'mcp', 'lsp'] as const) {
    const prefix = `${kind}-`;
    if (base.startsWith(prefix) && base.length > prefix.length) {
      return { kind, component: base.slice(prefix.length) };
    }
  }
  return { kind: 'custom', component: base };
}

function kindRank(kind: PluginSuiteScenarioKind): number {
  return ['load', 'command', 'agent', 'skill', 'hook', 'mcp', 'lsp', 'custom'].indexOf(kind);
}

async function assertRegularFile(file: string, label: string): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${file}`);
  if (!info.isFile()) throw new Error(`${label} must be a regular file: ${file}`);
}

function parsedDiscoverySurface(value: unknown): { pluginName: string; keys: string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('discovery.json must contain a JSON object.');
  const record = value as Record<string, unknown>;
  if (typeof record.pluginName !== 'string' || !record.pluginName) throw new Error('discovery.json is missing pluginName.');
  const keys: string[] = [];
  for (const field of ['commands', 'agents', 'skills', 'hooks', 'mcpServers'] as const) {
    const entries = record[field] ?? [];
    if (!Array.isArray(entries)) throw new Error(`discovery.json ${field} must be an array.`);
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`discovery.json ${field} contains an invalid component.`);
      const component = entry as Record<string, unknown>;
      if (typeof component.name !== 'string' || typeof component.path !== 'string') throw new Error(`discovery.json ${field} component is missing name/path.`);
      keys.push(`${field}\u0000${component.name}\u0000${component.path}`);
    }
  }
  const lsp = record.lspServers ?? [];
  if (!Array.isArray(lsp)) throw new Error('discovery.json lspServers must be an array.');
  for (const entry of lsp) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('discovery.json lspServers contains an invalid component.');
    const component = entry as Record<string, unknown>;
    if (typeof component.name !== 'string' || typeof component.path !== 'string' || typeof component.command !== 'string' || !Array.isArray(component.extensions)) throw new Error('discovery.json LSP component is incomplete.');
    keys.push(`lspServers\u0000${component.name}\u0000${component.path}\u0000${component.command}\u0000${JSON.stringify(component.extensions)}`);
  }
  const monitors = record.monitors ?? [];
  if (!Array.isArray(monitors)) throw new Error('discovery.json monitors must be an array.');
  for (const entry of monitors) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('discovery.json monitors contains an invalid component.');
    const monitor = entry as Record<string, unknown>;
    if (typeof monitor.name !== 'string' || typeof monitor.path !== 'string' || typeof monitor.command !== 'string' || typeof monitor.description !== 'string') throw new Error('discovery.json monitor is incomplete.');
    keys.push(`monitors\u0000${monitor.name}\u0000${monitor.path}\u0000${monitor.command}\u0000${monitor.description}\u0000${String(monitor.when ?? '')}`);
  }
  const dependencies = record.dependencies ?? [];
  if (!Array.isArray(dependencies)) throw new Error('discovery.json dependencies must be an array.');
  for (const entry of dependencies) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('discovery.json dependencies contains an invalid dependency.');
    const dependency = entry as Record<string, unknown>;
    if (typeof dependency.name !== 'string') throw new Error('discovery.json dependency is missing name.');
    keys.push(`dependencies\u0000${dependency.name}\u0000${String(dependency.version ?? '')}\u0000${String(dependency.marketplace ?? '')}`);
  }
  return { pluginName: record.pluginName, keys: keys.sort() };
}

function liveDiscoverySurface(discovery: PluginDiscovery): string[] {
  const keys = [
    ...(['commands', 'agents', 'skills', 'hooks', 'mcpServers'] as const).flatMap((field) => discovery[field].map((entry) => `${field}\u0000${entry.name}\u0000${entry.path}`)),
    ...discovery.lspServers.map((entry) => `lspServers\u0000${entry.name}\u0000${entry.path}\u0000${entry.command}\u0000${JSON.stringify(entry.extensions)}`),
    ...discovery.monitors.map((entry) => `monitors\u0000${entry.name}\u0000${entry.path}\u0000${entry.command}\u0000${entry.description}\u0000${entry.when ?? ''}`),
    ...discovery.dependencies.map((entry) => `dependencies\u0000${entry.name}\u0000${entry.version ?? ''}\u0000${entry.marketplace ?? ''}`),
  ];
  return keys.sort();
}

function displaySurfaceKey(key: string): string {
  return key.split('\u0000').join(':');
}

export async function assertGeneratedPluginSuiteFresh(suiteDir: string, discovery: PluginDiscovery): Promise<void> {
  const discoveryFile = path.join(path.resolve(suiteDir), 'discovery.json');
  try {
    await assertRegularFile(discoveryFile, 'Plugin suite discovery metadata');
  } catch (error) {
    if (error instanceof Error && error.message.includes('symbolic link')) throw error;
    throw new Error(`Generated plugin suite is missing a regular discovery.json file: ${suiteDir}. Re-run plugin-init.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(discoveryFile, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse plugin suite discovery.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const saved = parsedDiscoverySurface(parsed);
  if (saved.pluginName !== discovery.pluginName) {
    throw new Error(`Generated suite belongs to plugin ${saved.pluginName}, but --plugin resolves to ${discovery.pluginName}.`);
  }

  const live = liveDiscoverySurface(discovery);
  const savedSet = new Set(saved.keys);
  const liveSet = new Set(live);
  const added = live.filter((key) => !savedSet.has(key));
  const removed = saved.keys.filter((key) => !liveSet.has(key));
  if (added.length || removed.length) {
    const details = [
      ...added.slice(0, 3).map((key) => `added ${displaySurfaceKey(key)}`),
      ...removed.slice(0, 3).map((key) => `removed ${displaySurfaceKey(key)}`),
    ];
    throw new Error(
      `Generated plugin suite is stale: plugin surface changed (${added.length} added, ${removed.length} removed)` +
      `${details.length ? `: ${details.join(', ')}` : ''}. ` +
      `Re-run claude-canary plugin-init ${discovery.pluginRoot} --output ${path.resolve(suiteDir)} --force before testing the suite.`,
    );
  }
}

export function expectedGeneratedPluginSuiteScenarioIds(discovery: PluginDiscovery): string[] {
  const ids = ['load'];
  for (const component of discovery.commands) ids.push(`command-${safeSlug(component.name)}`);
  for (const component of discovery.agents) ids.push(`agent-${safeSlug(component.name)}`);
  for (const component of discovery.skills) ids.push(`skill-${safeSlug(component.name)}`);
  for (const component of discovery.hooks) ids.push(`hook-${safeSlug(component.name)}`);
  for (const component of discovery.mcpServers) ids.push(`mcp-${safeSlug(component.name)}`);
  for (const component of discovery.lspServers) ids.push(`lsp-${safeSlug(component.name)}`);
  return ids;
}

export function assertGeneratedPluginSuiteCoverage(scenarios: PluginSuiteScenario[], discovery: PluginDiscovery): void {
  const actual = new Set(scenarios.map((scenario) => scenario.id));
  const missing = expectedGeneratedPluginSuiteScenarioIds(discovery).filter((id) => !actual.has(id));
  if (missing.length) {
    throw new Error(
      `Generated plugin suite is incomplete: missing ${missing.length} expected scenario${missing.length === 1 ? '' : 's'} ` +
      `(${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). Re-run plugin-init --force before testing the suite.`,
    );
  }
}

export async function loadGeneratedPluginSuite(suiteDir: string): Promise<PluginSuiteScenario[]> {
  const absolute = path.resolve(suiteDir);
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    throw new Error(`Plugin suite directory does not exist: ${suiteDir}. Run claude-canary plugin-init first.`);
  }
  if (info.isSymbolicLink()) throw new Error(`Plugin suite directory must not be a symbolic link: ${suiteDir}`);
  if (!info.isDirectory()) throw new Error(`Plugin suite path must be a directory: ${suiteDir}`);

  const marker = path.join(absolute, PLUGIN_INIT_MARKER);
  try {
    await assertRegularFile(marker, 'Plugin suite marker');
  } catch (error) {
    if (error instanceof Error && error.message.includes('symbolic link')) throw error;
    throw new Error(`Refusing plugin suite directory without Canary's ${PLUGIN_INIT_MARKER} marker: ${suiteDir}`);
  }

  const markerText = await readFile(marker, 'utf8');
  if (!markerText.includes('claude-canary plugin-init')) {
    throw new Error(`Plugin suite marker is not recognized as Canary-generated: ${marker}`);
  }

  const files = (await readdir(absolute))
    .filter((file) => /\.canary\.ya?ml$/i.test(file))
    .sort();
  if (files.length === 0) throw new Error(`No *.canary.yml scenarios found in plugin suite: ${suiteDir}`);
  if (files.length > MAX_SUITE_SCENARIOS) {
    throw new Error(`Plugin suite contains ${files.length} scenarios; the safety limit is ${MAX_SUITE_SCENARIOS}. Split the suite before running it.`);
  }

  const scenarios: PluginSuiteScenario[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const absoluteFile = path.join(absolute, file);
    await assertRegularFile(absoluteFile, 'Plugin suite scenario');
    const parsed = await loadScenario(absoluteFile);
    const id = file.replace(/\.canary\.ya?ml$/i, '');
    if (ids.has(id)) throw new Error(`Duplicate plugin suite scenario id: ${id}`);
    ids.add(id);
    const classified = scenarioKindFromFile(file);
    scenarios.push({
      id,
      ...classified,
      path: normalizeRelative(absoluteFile),
      scenario: parsed,
    });
  }

  return scenarios.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.id.localeCompare(b.id));
}

export function validatePluginSuiteRunBudget(scenarioCount: number, versionCount: number, maxRuns = DEFAULT_MAX_SUITE_RUNS): number {
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > HARD_MAX_SUITE_RUNS) {
    throw new Error(`--max-runs must be an integer between 1 and ${HARD_MAX_SUITE_RUNS}.`);
  }
  const total = scenarioCount * versionCount;
  if (total > maxRuns) {
    throw new Error(
      `Plugin suite would run ${scenarioCount} scenarios × ${versionCount} releases = ${total} Claude runs, exceeding --max-runs ${maxRuns}. ` +
      'Narrow the release selector or explicitly raise --max-runs after reviewing the cost.',
    );
  }
  return total;
}

export function aggregatePluginSuiteMatrices(
  pluginName: string,
  suiteDir: string,
  versions: string[],
  matrices: Array<{ suiteScenario: PluginSuiteScenario; matrix: PluginMatrixResult }>,
): PluginSuiteResult {
  if (matrices.length === 0) throw new Error('Cannot aggregate an empty plugin suite.');
  const gitCommits = new Set(matrices.map(({ matrix }) => matrix.gitCommit));
  if (gitCommits.size !== 1) throw new Error('Plugin suite matrices did not run from the same Git commit.');

  for (const { matrix } of matrices) {
    const versionMismatch = matrix.versions.length !== versions.length || matrix.versions.some((version, index) => version !== versions[index]);
    const entryMismatch = matrix.entries.length !== versions.length || matrix.entries.some((entry, index) => entry.version !== versions[index]);
    if (versionMismatch || entryMismatch) {
      throw new Error(`Plugin suite scenario ${matrix.scenario} did not run the exact selected release set.`);
    }
  }

  const scenarios: PluginSuiteScenarioResult[] = matrices.map(({ suiteScenario, matrix }) => ({
    id: suiteScenario.id,
    kind: suiteScenario.kind,
    component: suiteScenario.component,
    path: suiteScenario.path,
    scenario: matrix.scenario,
    entries: matrix.entries,
    compatible: matrix.compatible,
    incompatible: matrix.incompatible,
    firstIncompatibleVersion: matrix.firstIncompatibleVersion,
  }));

  const versionResults: PluginSuiteVersionResult[] = versions.map((version, versionIndex) => {
    const entries = matrices.map(({ suiteScenario, matrix }) => ({ suiteScenario, entry: matrix.entries[versionIndex] }));
    const failures = entries
      .filter(({ entry }) => !entry.passed)
      .map(({ suiteScenario, entry }) => ({
        scenarioId: suiteScenario.id,
        scenario: suiteScenario.scenario.name,
        path: suiteScenario.path,
        failures: entry.failures,
      }));
    const costs = entries.map(({ entry }) => entry.costUsd).filter((value): value is number => value !== undefined);
    return {
      version,
      passed: failures.length === 0,
      passedScenarios: entries.length - failures.length,
      failedScenarios: failures.length,
      durationMs: entries.reduce((sum, { entry }) => sum + entry.durationMs, 0),
      toolCalls: entries.reduce((sum, { entry }) => sum + entry.toolCalls, 0),
      totalTokens: entries.reduce((sum, { entry }) => sum + entry.totalTokens, 0),
      costUsd: costs.length === entries.length ? costs.reduce((sum, value) => sum + value, 0) : undefined,
      failures,
    };
  });

  const totalRuns = versions.length * scenarios.length;
  const compatibleRuns = scenarios.reduce((sum, scenario) => sum + scenario.compatible, 0);
  const compatibleVersions = versionResults.filter((result) => result.passed).length;
  return {
    schemaVersion: 1,
    kind: 'plugin-compatibility-suite',
    canaryVersion: CANARY_VERSION,
    pluginName,
    suiteDir: normalizeRelative(suiteDir),
    gitCommit: [...gitCommits][0] ?? '',
    versions,
    scenarios,
    versionResults,
    totalRuns,
    compatibleRuns,
    incompatibleRuns: totalRuns - compatibleRuns,
    compatibleVersions,
    incompatibleVersions: versionResults.length - compatibleVersions,
    firstIncompatibleVersion: versionResults.find((result) => !result.passed)?.version,
    createdAt: new Date().toISOString(),
  };
}

function matrixCell(entry: PluginMatrixEntry): string {
  return entry.passed ? '✅' : '❌';
}

export function formatPluginSuiteMarkdown(result: PluginSuiteResult): string {
  const scenarioHeaders = result.scenarios.map((scenario) => scenario.id.replace(/\|/g, '\\|'));
  const rows = result.versions.map((version, versionIndex) => {
    const cells = result.scenarios.map((scenario) => matrixCell(scenario.entries[versionIndex]));
    const versionResult = result.versionResults[versionIndex];
    return `| \`${version}\` | ${cells.join(' | ')} | ${versionResult.passed ? '✅ Compatible' : `❌ ${versionResult.failedScenarios} failed`} |`;
  });
  const divider = ['---', ...scenarioHeaders.map(() => ':---:'), '---'].join(' | ');

  const scenarioSummary = result.scenarios.map((scenario) => {
    const first = scenario.firstIncompatibleVersion ? `\`${scenario.firstIncompatibleVersion}\`` : '—';
    return `| \`${scenario.id}\` | ${scenario.kind} | ${scenario.compatible}/${result.versions.length} | ${first} |`;
  });

  const failureSections = result.versionResults
    .filter((version) => !version.passed)
    .map((version) => {
      const items = version.failures.map((failure) => {
        const details = failure.failures.length ? failure.failures.join('; ').replace(/\n/g, ' ') : 'Scenario failed';
        return `- \`${failure.scenarioId}\`: ${details}`;
      });
      return `### ${version.version}\n\n${items.join('\n')}`;
    });

  const headline = result.firstIncompatibleVersion
    ? `**First release with any suite failure:** \`${result.firstIncompatibleVersion}\``
    : '**All tested releases pass every generated smoke scenario.**';

  return `# Claude Code plugin compatibility suite\n\n` +
    `Plugin: **${result.pluginName}**  \n` +
    `Suite: \`${result.suiteDir}\`  \n` +
    `Git commit: \`${result.gitCommit}\`  \n` +
    `Generated by Claude Code Canary ${result.canaryVersion}.\n\n` +
    `${headline}\n\n` +
    `## Full compatibility matrix\n\n` +
    `| Claude Code | ${scenarioHeaders.join(' | ')} | Overall |\n` +
    `| ${divider} |\n` +
    `${rows.join('\n')}\n\n` +
    `## Scenario summary\n\n` +
    `| Scenario | Kind | Compatible releases | First failure |\n` +
    `| --- | --- | ---: | --- |\n` +
    `${scenarioSummary.join('\n')}\n\n` +
    `Runs: **${result.totalRuns}** · Passed: **${result.compatibleRuns}** · Failed: **${result.incompatibleRuns}**  \n` +
    `Fully compatible releases: **${result.compatibleVersions}** · Releases with failures: **${result.incompatibleVersions}**\n` +
    (failureSections.length ? `\n## Failure details\n\n${failureSections.join('\n\n')}\n` : '');
}

async function writeSuiteArtifacts(cwd: string, result: PluginSuiteResult): Promise<{ json: string; markdown: string }> {
  const repoRoot = await getRepoRoot(cwd);
  const stamp = result.createdAt.replace(/[:.]/g, '-');
  const base = `${stamp}-${safeSlug(result.pluginName)}-plugin-suite`;
  const jsonRelative = path.join('.canary', 'results', `${base}.json`);
  const markdownRelative = path.join('.canary', 'results', `${base}.md`);
  const jsonAbsolute = path.join(repoRoot, jsonRelative);
  const markdownAbsolute = path.join(repoRoot, markdownRelative);
  await mkdir(path.dirname(jsonAbsolute), { recursive: true });
  const persisted = { ...result };
  delete persisted.jsonArtifactPath;
  delete persisted.markdownArtifactPath;
  await writeFile(jsonAbsolute, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  await writeFile(markdownAbsolute, formatPluginSuiteMarkdown(result), 'utf8');
  return { json: normalizeRelative(jsonRelative), markdown: normalizeRelative(markdownRelative) };
}

export async function runPluginSuite(options: RunPluginSuiteOptions): Promise<PluginSuiteResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const pluginPath = path.resolve(cwd, options.pluginPath);
  const discovery = await discoverPlugin(pluginPath);
  const suiteDir = path.resolve(cwd, options.suiteDir ?? path.join('.canary', 'plugins', discovery.pluginName));
  await assertGeneratedPluginSuiteFresh(suiteDir, discovery);
  const loadedScenarios = await loadGeneratedPluginSuite(suiteDir);
  assertGeneratedPluginSuiteCoverage(loadedScenarios, discovery);
  const scenarios = loadedScenarios.map((scenario) => ({
    ...scenario,
    path: normalizeRelative(path.relative(cwd, scenario.path)),
  }));
  const versions = await resolvePluginMatrixVersions({
    versions: options.versions,
    from: options.from,
    to: options.to,
    last: options.last,
  });
  if (versions.length === 0) throw new Error('No Claude Code releases selected for plugin suite.');

  const totalRuns = validatePluginSuiteRunBudget(scenarios.length, versions.length, options.maxRuns ?? DEFAULT_MAX_SUITE_RUNS);
  options.onStatus?.(`Plugin suite ${discovery.pluginName}: ${scenarios.length} scenarios × ${versions.length} releases = ${totalRuns} runs.`);

  const runner = options.matrixRunner ?? runPluginMatrix;
  const matrices: Array<{ suiteScenario: PluginSuiteScenario; matrix: PluginMatrixResult }> = [];
  for (const [index, suiteScenario] of scenarios.entries()) {
    options.onStatus?.(`[${index + 1}/${scenarios.length}] Running ${suiteScenario.id} across ${versions.length} releases...`);
    const matrix = await runner(suiteScenario.scenario, {
      cwd,
      pluginPath,
      versions,
      platform: options.platform,
      writeArtifacts: false,
      onStatus: options.onStatus,
    });
    matrices.push({ suiteScenario, matrix });
  }

  const result = aggregatePluginSuiteMatrices(
    discovery.pluginName,
    normalizeRelative(path.relative(cwd, suiteDir) || '.'),
    versions,
    matrices,
  );
  if (options.writeArtifacts !== false) {
    const artifacts = await writeSuiteArtifacts(cwd, result);
    result.jsonArtifactPath = artifacts.json;
    result.markdownArtifactPath = artifacts.markdown;
  }
  return result;
}
