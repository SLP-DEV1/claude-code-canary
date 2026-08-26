import { access, chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import type { Scenario } from './config.js';
import { loadScenario } from './config.js';
import { createDetachedWorktree, getRepoRoot, resolveCommit } from './git.js';
import { redactSensitiveText } from './record.js';
import type { RunResult } from './types.js';
import { CANARY_VERSION } from './version.js';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const GLOB_META = /[*?\[\]{}!]/;
const DENY_SEGMENTS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', 'target', '.next', '.cache', '.turbo',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.gradle', '.idea', '.vscode',
]);
const DENY_BASENAME_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /^(?:credentials?|secrets?)(?:\..*)?$/i,
  /^service[-_.]?account.*\.json$/i,
];

const COMMON_MANIFESTS: Array<{ when: RegExp; files: string[] }> = [
  { when: /\b(?:npm|npx|pnpm|yarn|node)\b/i, files: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json'] },
  { when: /\b(?:python|python3|pytest|pip|pip3|uv|poetry)\b/i, files: ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'uv.lock', 'poetry.lock'] },
  { when: /\bcargo\b/i, files: ['Cargo.toml', 'Cargo.lock'] },
  { when: /\bgo\b/i, files: ['go.mod', 'go.sum'] },
  { when: /\b(?:mvn|maven)\b/i, files: ['pom.xml'] },
  { when: /\b(?:gradle|gradlew)\b/i, files: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat'] },
];

export interface ReproOptions {
  cwd?: string;
  scenarioPath?: string;
  output?: string;
  force?: boolean;
}

export interface ReproBundleResult {
  outputPath: string;
  scenarioPath: string;
  baseCommit: string;
  exportedFiles: string[];
  skippedFiles: string[];
  redactedFiles: string[];
}

interface LoadedResult extends RunResult {
  artifactPath?: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'repro';
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function posixRelative(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Unsafe fixture path: ${value}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe fixture path: ${value}`);
  }
  return parts.join('/');
}

export function isDeniedFixturePath(value: string): boolean {
  let normalized: string;
  try {
    normalized = posixRelative(value);
  } catch {
    return true;
  }
  const parts = normalized.split('/');
  if (parts.some((part) => DENY_SEGMENTS.has(part))) return true;
  const base = parts.at(-1) ?? '';
  return DENY_BASENAME_PATTERNS.some((pattern) => pattern.test(base));
}

export function fixtureRootFromPattern(pattern: string): string | null {
  const normalized = posixRelative(pattern);
  const match = normalized.match(GLOB_META);
  if (!match || match.index === undefined) return normalized;
  const prefix = normalized.slice(0, match.index).replace(/\/+$/, '');
  if (!prefix) return null;
  const lastSlash = prefix.lastIndexOf('/');
  if (prefix.endsWith('/')) return prefix.slice(0, -1) || null;
  if (lastSlash < 0 && !prefix.includes('.')) return prefix;
  return lastSlash >= 0 ? prefix.slice(0, lastSlash) || null : null;
}

function commandsForScenario(scenario: Scenario): string {
  return [...(scenario.setup?.commands ?? []), ...(scenario.verify?.commands ?? [])].join('\n');
}

export function collectFixtureRoots(scenario: Scenario): string[] {
  const roots = new Set<string>();
  const changed = scenario.expect?.changed_files;
  const candidates = [
    ...(changed?.allow ?? []),
    ...(changed?.require ?? []),
    ...(scenario.expect?.files_exist ?? []),
    ...(scenario.expect?.files_absent ?? []),
    ...(scenario.expect?.file_contains ?? []).map((item) => item.path),
  ];
  for (const candidate of candidates) {
    const root = fixtureRootFromPattern(candidate);
    if (root && !isDeniedFixturePath(root)) roots.add(root);
  }
  const commandText = commandsForScenario(scenario);
  for (const group of COMMON_MANIFESTS) {
    if (group.when.test(commandText)) for (const file of group.files) roots.add(file);
  }
  return [...roots].sort();
}

function validateResult(value: unknown): LoadedResult {
  if (typeof value !== 'object' || value === null) throw new Error('Result artifact must be a JSON object.');
  const result = value as Partial<LoadedResult>;
  if (result.schemaVersion !== 1) throw new Error('Unsupported result artifact schema.');
  if (typeof result.scenario !== 'string' || !result.scenario) throw new Error('Result artifact is missing scenario name.');
  if (typeof result.gitCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(result.gitCommit)) throw new Error('Result artifact is missing a valid gitCommit.');
  if (typeof result.passed !== 'boolean') throw new Error('Result artifact is missing passed status.');
  if (!Array.isArray(result.failures) || !result.failures.every((item) => typeof item === 'string')) throw new Error('Result artifact failures are invalid.');
  if (!Array.isArray(result.changedFiles) || !result.changedFiles.every((item) => typeof item === 'string')) throw new Error('Result artifact changedFiles are invalid.');
  return result as LoadedResult;
}

async function loadResultArtifact(resultPath: string): Promise<LoadedResult> {
  let raw: string;
  try {
    raw = await readFile(resultPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read result artifact ${resultPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return validateResult(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Could not parse result artifact ${resultPath}.`);
  }
}

async function walkScenarioFiles(root: string, output: string[]): Promise<void> {
  if (!(await exists(root))) return;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'results' || entry.name === 'repro') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await walkScenarioFiles(absolute, output);
    else if (entry.isFile() && /\.canary\.ya?ml$/i.test(entry.name)) output.push(absolute);
  }
}

async function locateScenario(repoRoot: string, result: LoadedResult, explicit?: string): Promise<{ scenario: Scenario; path: string }> {
  if (explicit) {
    const absolute = path.resolve(repoRoot, explicit);
    const scenario = await loadScenario(absolute);
    if (scenario.name !== result.scenario) throw new Error(`Scenario ${explicit} is named ${scenario.name}, but result artifact is for ${result.scenario}.`);
    return { scenario, path: absolute };
  }

  const candidates: string[] = [];
  await walkScenarioFiles(path.join(repoRoot, '.canary'), candidates);
  const matches: Array<{ scenario: Scenario; path: string }> = [];
  for (const candidate of candidates) {
    try {
      const scenario = await loadScenario(candidate);
      if (scenario.name === result.scenario) matches.push({ scenario, path: candidate });
    } catch {
      // Ignore unrelated malformed scenario files while locating the exact result scenario.
    }
  }
  if (matches.length === 0) throw new Error(`Could not locate a .canary/*.canary.yml scenario named ${result.scenario}. Use --scenario <path>.`);
  if (matches.length > 1) throw new Error(`Multiple scenarios are named ${result.scenario}. Use --scenario <path> to select one explicitly.`);
  return matches[0];
}

function ensurePortableCommand(command: string): void {
  if (redactSensitiveText(command) !== command) {
    throw new Error('Scenario contains a setup/verification command with a secret-like value or machine-specific absolute path. Refusing to export a misleading or sensitive repro bundle.');
  }
}

function sanitizeScenario(source: Scenario): Scenario {
  const scenario = structuredClone(source);
  scenario.prompt = redactSensitiveText(scenario.prompt);
  scenario.claude.env = {};
  if (path.isAbsolute(scenario.claude.executable)) scenario.claude.executable = path.basename(scenario.claude.executable) || 'claude';
  for (const arg of scenario.claude.args) ensurePortableCommand(arg);
  for (const command of scenario.setup?.commands ?? []) ensurePortableCommand(command);
  for (const command of scenario.verify?.commands ?? []) ensurePortableCommand(command);
  if (scenario.recording?.executable && path.isAbsolute(scenario.recording.executable)) {
    scenario.recording.executable = path.basename(scenario.recording.executable) || 'claude';
  }
  scenario.recording = scenario.recording ? {
    ...scenario.recording,
    config_files: scenario.recording.config_files.filter((item) => {
      try { return !isDeniedFixturePath(item); } catch { return false; }
    }),
  } : undefined;
  return scenario;
}

function sanitizeJsonValue(value: unknown, key?: string): unknown {
  if (key === 'artifactPath') return undefined;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item)).filter((item) => item !== undefined);
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      const sanitized = sanitizeJsonValue(child, childKey);
      if (sanitized !== undefined) output[childKey] = sanitized;
    }
    return output;
  }
  return value;
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

interface CopyState {
  exported: string[];
  skipped: string[];
  redacted: string[];
  bytes: number;
}

async function copyTextFile(worktree: string, bundleFixture: string, relative: string, state: CopyState): Promise<void> {
  const normalized = posixRelative(relative);
  if (isDeniedFixturePath(normalized)) {
    state.skipped.push(`${normalized} (denylisted)`);
    return;
  }
  const source = path.join(worktree, ...normalized.split('/'));
  let info;
  try {
    info = await lstat(source);
  } catch {
    state.skipped.push(`${normalized} (not present at base commit)`);
    return;
  }
  if (info.isSymbolicLink()) {
    state.skipped.push(`${normalized} (symlink)`);
    return;
  }
  if (!info.isFile()) return;
  if (info.size > MAX_FILE_BYTES) {
    state.skipped.push(`${normalized} (larger than ${MAX_FILE_BYTES} bytes)`);
    return;
  }
  if (state.exported.length >= MAX_FILES) throw new Error(`Fixture export exceeded ${MAX_FILES} files. Narrow the scenario changed-file scopes before creating a public repro.`);
  if (state.bytes + info.size > MAX_TOTAL_BYTES) throw new Error(`Fixture export exceeded ${MAX_TOTAL_BYTES} bytes. Narrow the scenario changed-file scopes before creating a public repro.`);

  const buffer = await readFile(source);
  if (isBinary(buffer)) {
    state.skipped.push(`${normalized} (binary)`);
    return;
  }
  const text = buffer.toString('utf8');
  const redacted = redactSensitiveText(text);
  const destination = path.join(bundleFixture, ...normalized.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, redacted, 'utf8');
  state.exported.push(normalized);
  state.bytes += Buffer.byteLength(redacted);
  if (redacted !== text) state.redacted.push(normalized);
}

async function copyRoot(worktree: string, bundleFixture: string, root: string, state: CopyState): Promise<void> {
  if (isDeniedFixturePath(root)) {
    state.skipped.push(`${root} (denylisted)`);
    return;
  }
  const absolute = path.join(worktree, ...root.split('/'));
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    state.skipped.push(`${root} (not present at base commit)`);
    return;
  }
  if (info.isSymbolicLink()) {
    state.skipped.push(`${root} (symlink)`);
    return;
  }
  if (info.isFile()) {
    await copyTextFile(worktree, bundleFixture, root, state);
    return;
  }
  if (!info.isDirectory()) return;

  const walk = async (directoryRelative: string): Promise<void> => {
    const directory = path.join(worktree, ...directoryRelative.split('/'));
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = `${directoryRelative}/${entry.name}`;
      if (isDeniedFixturePath(child)) {
        state.skipped.push(`${child} (denylisted)`);
        continue;
      }
      if (entry.isSymbolicLink()) {
        state.skipped.push(`${child} (symlink)`);
      } else if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        await copyTextFile(worktree, bundleFixture, child, state);
      }
    }
  };
  await walk(root);
}

function buildEnvironment(scenario: Scenario, result: LoadedResult, baseCommit: string) {
  return {
    bundleSchemaVersion: 1,
    canaryVersion: CANARY_VERSION,
    platform: platform(),
    arch: arch(),
    nodeVersion: process.version,
    scenario: scenario.name,
    baseCommit,
    resultCreatedAt: result.createdAt,
    claude: {
      executable: path.basename(scenario.claude.executable) || scenario.claude.executable,
      recordedVersion: scenario.recording?.claude_version,
      model: scenario.claude.model ?? scenario.recording?.model,
    },
  };
}

function markdownList(values: string[], empty = '_None_'): string {
  return values.length ? values.map((value) => `- ${redactSensitiveText(value)}`).join('\n') : empty;
}

function buildIssueReport(scenario: Scenario, result: LoadedResult, baseCommit: string): string {
  return `# Claude Code Canary reproduction: ${scenario.name}\n\n` +
    `> Generated by Claude Code Canary ${CANARY_VERSION}. Review this file and the bundle contents before publishing. Raw model output and environment values are intentionally excluded.\n\n` +
    `## Summary\n\n` +
    `- Result: **${result.passed ? 'PASS' : 'FAIL'}**\n` +
    `- Base Git commit: \`${baseCommit}\`\n` +
    `- Claude executable: \`${redactSensitiveText(path.basename(scenario.claude.executable) || scenario.claude.executable)}\`\n` +
    `${scenario.recording?.claude_version ? `- Recorded Claude version: \`${redactSensitiveText(scenario.recording.claude_version)}\`\n` : ''}` +
    `${scenario.claude.model ? `- Model: \`${redactSensitiveText(scenario.claude.model)}\`\n` : ''}` +
    `- Tool calls: ${result.metrics?.toolCalls ?? 'unknown'}\n` +
    `- Total tokens: ${result.metrics?.totalTokens ?? 'unknown'}\n\n` +
    `## Deterministic failures\n\n${markdownList(result.failures)}\n\n` +
    `## Changed files\n\n${markdownList(result.changedFiles)}\n\n` +
    `## Reproduce\n\n` +
    `Linux/macOS:\n\n\`\`\`bash\n./reproduce.sh\n\`\`\`\n\n` +
    `Windows PowerShell:\n\n\`\`\`powershell\n./reproduce.ps1\n\`\`\`\n\n` +
    `The launchers create a local Git baseline inside \`fixture/\` and execute \`claude-canary run ../scenario.canary.yml\`.\n`;
}

function buildReadme(scenario: Scenario, baseCommit: string, state: CopyState): string {
  return `# Claude Code Canary reproduction bundle\n\n` +
    `Scenario: **${scenario.name}**  \nBase commit: \`${baseCommit}\`\n\n` +
    `This bundle is intentionally minimal and privacy-first. It does not contain raw Claude transcripts, environment values, Git metadata, dependency caches, build outputs, or known credential-file patterns.\n\n` +
    `## Before publishing\n\nReview every file in this directory. Redaction is a safety net, not a guarantee that project-specific confidential information is absent.\n\n` +
    `## Exported fixture files\n\n${markdownList(state.exported)}\n\n` +
    `## Redacted fixture files\n\n${markdownList(state.redacted)}\n\n` +
    `## Skipped fixture entries\n\n${markdownList(state.skipped)}\n\n` +
    `## Run\n\nUse \`./reproduce.sh\` on Linux/macOS or \`./reproduce.ps1\` on Windows PowerShell.\n`;
}

const SH_LAUNCHER = `#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\ncd "$SCRIPT_DIR/fixture"\nif [ ! -d .git ]; then\n  git init -q\n  git add -A\n  git -c user.name='Claude Canary Repro' -c user.email='repro@example.invalid' commit -qm 'fixture baseline' --allow-empty\nfi\nclaude-canary run ../scenario.canary.yml\n`;

const PS_LAUNCHER = `$ErrorActionPreference = 'Stop'\n$Root = Split-Path -Parent $MyInvocation.MyCommand.Path\nSet-Location (Join-Path $Root 'fixture')\nif (-not (Test-Path '.git')) {\n  git init -q\n  git add -A\n  git -c user.name='Claude Canary Repro' -c user.email='repro@example.invalid' commit -qm 'fixture baseline' --allow-empty\n}\nclaude-canary run ../scenario.canary.yml\n`;

export async function createReproBundle(resultPath: string, options: ReproOptions = {}): Promise<ReproBundleResult> {
  const repoRoot = await getRepoRoot(options.cwd ?? process.cwd());
  const result = await loadResultArtifact(path.resolve(repoRoot, resultPath));
  if (result.passed) throw new Error('Reproduction bundles are intended for failed Canary results; this artifact passed.');

  const located = await locateScenario(repoRoot, result, options.scenarioPath);
  const scenario = sanitizeScenario(located.scenario);
  const baseCommitInput = scenario.recording?.git_commit ?? result.gitCommit;
  const baseCommit = await resolveCommit(repoRoot, baseCommitInput);
  const defaultOutput = path.join(repoRoot, '.canary', 'repro', `${slug(scenario.name)}-${baseCommit.slice(0, 8)}`);
  const output = path.resolve(repoRoot, options.output ?? defaultOutput);
  if (await exists(output)) {
    if (!options.force) throw new Error(`Repro output already exists: ${output}. Use --force to replace it.`);
    await rm(output, { recursive: true, force: true });
  }
  await mkdir(path.join(output, 'fixture'), { recursive: true });

  const worktree = await createDetachedWorktree(repoRoot, baseCommit);
  const state: CopyState = { exported: [], skipped: [], redacted: [], bytes: 0 };
  try {
    for (const root of collectFixtureRoots(scenario)) await copyRoot(worktree.path, path.join(output, 'fixture'), root, state);
  } finally {
    await worktree.cleanup();
  }

  const sanitizedResult = sanitizeJsonValue(result);
  const environment = buildEnvironment(scenario, result, baseCommit);
  await writeFile(path.join(output, 'scenario.canary.yml'), YAML.stringify(scenario), 'utf8');
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify(sanitizedResult, null, 2)}\n`, 'utf8');
  await writeFile(path.join(output, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`, 'utf8');
  await writeFile(path.join(output, 'fixture-manifest.json'), `${JSON.stringify({ exported: state.exported, redacted: state.redacted, skipped: state.skipped }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(output, 'issue-report.md'), buildIssueReport(scenario, result, baseCommit), 'utf8');
  await writeFile(path.join(output, 'README.md'), buildReadme(scenario, baseCommit, state), 'utf8');
  await writeFile(path.join(output, 'reproduce.sh'), SH_LAUNCHER, 'utf8');
  await chmod(path.join(output, 'reproduce.sh'), 0o755);
  await writeFile(path.join(output, 'reproduce.ps1'), PS_LAUNCHER, 'utf8');

  return {
    outputPath: output,
    scenarioPath: path.relative(repoRoot, located.path).split(path.sep).join('/'),
    baseCommit,
    exportedFiles: state.exported,
    skippedFiles: state.skipped,
    redactedFiles: state.redacted,
  };
}
