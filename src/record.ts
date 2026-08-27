import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { Scenario } from './config.js';
import { getChangedFiles, getGitDir, getHeadCommit, getRepoRoot } from './git.js';
import { spawnCapture } from './process.js';

const CONFIG_METADATA_PATHS = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  '.claude/CLAUDE.md',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/rules',
  '.claude/hooks',
  '.claude/commands',
  '.claude/agents',
  '.mcp.json',
];

export interface RecordingState {
  schemaVersion: 1;
  name: string;
  prompt: string;
  promptRedacted: boolean;
  startCommit: string;
  createdAt: string;
  setupCommands: string[];
  verifyCommands: string[];
  claude: {
    executable: string;
    version?: string;
    model?: string;
  };
  configFiles: string[];
}

export interface StartRecordingOptions {
  cwd?: string;
  prompt: string;
  setupCommands?: string[];
  verifyCommands?: string[];
  executable?: string;
  model?: string;
  force?: boolean;
}

export interface FinishRecordingOptions {
  cwd?: string;
  output?: string;
  setupCommands?: string[];
  verifyCommands?: string[];
}

export interface FinishRecordingResult {
  scenario: Scenario;
  scenarioPath: string;
  changedFiles: string[];
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function recordingSlug(name: string): string {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(trimmed)) {
    throw new Error('Recording name must be 1-80 characters and contain only letters, numbers, dot, underscore or dash.');
  }
  return trimmed.toLowerCase();
}

export function redactSensitiveText(value: string): string {
  let output = value;

  output = output.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]',
  );

  const tokenPatterns = [
    /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\bgsk_[A-Za-z0-9_-]{20,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  ];
  for (const pattern of tokenPatterns) output = output.replace(pattern, '[REDACTED_SECRET]');

  output = output.replace(
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)\b(\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`,
  );

  output = output.replace(/\b[A-Za-z]:\\(?:[^\\\s"'`]+\\)*[^\\\s"'`]*/g, '<ABSOLUTE_PATH>');
  output = output.replace(
    /(^|[\s"'(])\/(?:Users|home|private|tmp|var|opt|mnt|srv|workspace)\/[^\s"'`)]+/gm,
    (_match, prefix: string) => `${prefix}<ABSOLUTE_PATH>`,
  );
  output = output.replace(
    /(^|[\s"'(])~\/[^\s"'`)]+/gm,
    (_match, prefix: string) => `${prefix}<HOME_PATH>`,
  );

  return output;
}

export function assertPortableCommands(commands: string[]): string[] {
  return commands.map((command) => {
    if (!command.trim()) throw new Error('Setup/verification commands must not be empty.');
    if (redactSensitiveText(command) !== command) {
      throw new Error(`Refusing to persist non-portable or secret-bearing command: ${command}. Use repository-relative commands and environment-based credentials.`);
    }
    return command;
  });
}

async function captureClaudeVersion(executable: string, cwd: string): Promise<string | undefined> {
  const result = await spawnCapture(executable, ['--version'], { cwd, timeoutMs: 10_000 });
  if (result.code !== 0) return undefined;
  const version = redactSensitiveText(result.stdout.trim() || result.stderr.trim()).replace(/\s+/g, ' ').slice(0, 240);
  return version || undefined;
}

async function captureConfigMetadata(repoRoot: string): Promise<string[]> {
  const present: string[] = [];
  for (const relative of CONFIG_METADATA_PATHS) {
    if (await exists(path.join(repoRoot, relative))) present.push(relative);
  }
  return present;
}

async function recordingStatePath(repoRoot: string, name: string): Promise<string> {
  const gitDir = await getGitDir(repoRoot);
  return path.join(gitDir, 'cc-canary', 'recordings', `${recordingSlug(name)}.json`);
}

function portableExecutable(executable: string): string {
  if (path.isAbsolute(executable)) return path.basename(executable) || 'claude';
  return executable;
}

export async function startRecording(name: string, options: StartRecordingOptions): Promise<RecordingState> {
  const repoRoot = await getRepoRoot(options.cwd ?? process.cwd());
  const dirty = await getChangedFiles(repoRoot);
  if (dirty.length > 0) {
    throw new Error(`Recording requires a completely clean working tree, including untracked files. Found: ${dirty.join(', ')}`);
  }

  const statePath = await recordingStatePath(repoRoot, name);
  if (!options.force && await exists(statePath)) {
    throw new Error(`Recording ${recordingSlug(name)} already exists. Use --force to replace the pending recording.`);
  }

  const setupCommands = assertPortableCommands(options.setupCommands ?? []);
  const verifyCommands = assertPortableCommands(options.verifyCommands ?? []);
  const executable = options.executable ?? 'claude';
  const redactedPrompt = redactSensitiveText(options.prompt);

  const state: RecordingState = {
    schemaVersion: 1,
    name,
    prompt: redactedPrompt,
    promptRedacted: redactedPrompt !== options.prompt,
    startCommit: await getHeadCommit(repoRoot),
    createdAt: new Date().toISOString(),
    setupCommands,
    verifyCommands,
    claude: {
      executable: portableExecutable(executable),
      version: await captureClaudeVersion(executable, repoRoot),
      model: options.model,
    },
    configFiles: await captureConfigMetadata(repoRoot),
  };

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

async function loadRecording(repoRoot: string, name: string): Promise<{ state: RecordingState; path: string }> {
  const statePath = await recordingStatePath(repoRoot, name);
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf8');
  } catch {
    throw new Error(`No pending recording named ${recordingSlug(name)}. Start one with claude-canary record first.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Pending recording ${recordingSlug(name)} is corrupted JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error(`Pending recording ${recordingSlug(name)} has an unsupported schema.`);
  }
  return { state: parsed as RecordingState, path: statePath };
}

function outputInsideRepo(repoRoot: string, output: string): { absolute: string; relative: string } {
  const absolute = path.resolve(repoRoot, output);
  const relativeNative = path.relative(repoRoot, absolute);
  if (!relativeNative || relativeNative === '..' || relativeNative.startsWith(`..${path.sep}`) || path.isAbsolute(relativeNative)) {
    throw new Error('Recorded scenario output must stay inside the repository.');
  }
  return { absolute, relative: relativeNative.split(path.sep).join('/') };
}

async function partitionChangedFiles(repoRoot: string, changedFiles: string[]): Promise<{ filesExist: string[]; filesAbsent: string[] }> {
  const filesExist: string[] = [];
  const filesAbsent: string[] = [];
  for (const relative of changedFiles) {
    try {
      await stat(path.join(repoRoot, relative));
      filesExist.push(relative);
    } catch {
      filesAbsent.push(relative);
    }
  }
  return { filesExist, filesAbsent };
}

export function buildRecordedScenario(
  state: RecordingState,
  changedFiles: string[],
  filesExist: string[],
  filesAbsent: string[],
  setupCommands: string[],
  verifyCommands: string[],
): Scenario {
  return {
    version: 1,
    name: state.name,
    prompt: state.prompt,
    setup: setupCommands.length > 0 ? { commands: setupCommands } : undefined,
    claude: {
      executable: state.claude.executable || 'claude',
      args: [],
      model: state.claude.model,
      permission_mode: 'acceptEdits',
      include_hook_events: false,
      max_turns: 10,
      timeout_seconds: 900,
      env: {},
    },
    verify: verifyCommands.length > 0 ? { commands: verifyCommands } : undefined,
    expect: {
      changed_files: {
        allow: changedFiles,
        require: changedFiles,
        deny: [],
      },
      files_exist: filesExist,
      files_absent: filesAbsent,
      file_contains: [],
    },
    recording: {
      git_commit: state.startCommit,
      recorded_at: new Date().toISOString(),
      claude_version: state.claude.version,
      executable: state.claude.executable,
      model: state.claude.model,
      config_files: state.configFiles,
      prompt_redacted: state.promptRedacted,
    },
  };
}

export async function finishRecording(name: string, options: FinishRecordingOptions = {}): Promise<FinishRecordingResult> {
  const repoRoot = await getRepoRoot(options.cwd ?? process.cwd());
  const pending = await loadRecording(repoRoot, name);
  const currentCommit = await getHeadCommit(repoRoot);
  if (currentCommit !== pending.state.startCommit) {
    throw new Error(`HEAD moved from recorded start commit ${pending.state.startCommit} to ${currentCommit}. Save the recording before committing or changing branches.`);
  }

  const changedFiles = await getChangedFiles(repoRoot);
  if (changedFiles.length === 0) {
    throw new Error('No file changes were detected. Run the Claude task before saving the recording.');
  }

  const extraSetup = assertPortableCommands(options.setupCommands ?? []);
  const extraVerify = assertPortableCommands(options.verifyCommands ?? []);
  const setupCommands = [...new Set([...pending.state.setupCommands, ...extraSetup])];
  const verifyCommands = [...new Set([...pending.state.verifyCommands, ...extraVerify])];
  const { filesExist, filesAbsent } = await partitionChangedFiles(repoRoot, changedFiles);
  const scenario = buildRecordedScenario(pending.state, changedFiles, filesExist, filesAbsent, setupCommands, verifyCommands);

  const target = outputInsideRepo(repoRoot, options.output ?? path.join('.canary', `${recordingSlug(name)}.canary.yml`));
  await mkdir(path.dirname(target.absolute), { recursive: true });
  await writeFile(target.absolute, YAML.stringify(scenario), 'utf8');
  await rm(pending.path, { force: true });

  return { scenario, scenarioPath: target.relative, changedFiles };
}
