import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Scenario } from './config.js';
import { evaluateExpectations } from './evaluate.js';
import { createDetachedWorktree, getChangedFiles, getRepoRoot, getTrackedChanges, resolveCommit } from './git.js';
import { parseStreamMetrics } from './metrics.js';
import { runShellCommand, spawnCapture } from './process.js';
import type { CommandSummary, ProcessResult, RunResult } from './types.js';

export interface PreparedRun {
  extraClaudeArgs?: string[];
  env?: NodeJS.ProcessEnv;
  fixtureState?: Record<string, string | null>;
  cleanup?: () => Promise<void>;
}

export interface RunOptions {
  cwd?: string;
  executableOverride?: string;
  artifactLabel?: string;
  prepareWorktree?: (worktreePath: string) => Promise<PreparedRun>;
  gitRefOverride?: string;
  allowDirtyWorkingTree?: boolean;
}

function summarize(command: string, result: ProcessResult): CommandSummary {
  return { command, code: result.code, durationMs: result.durationMs, timedOut: result.timedOut };
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'run';
}

async function writeArtifact(repoRoot: string, result: RunResult, label?: string): Promise<string> {
  const dir = path.join(repoRoot, '.canary', 'results');
  await mkdir(dir, { recursive: true });
  const stamp = result.createdAt.replace(/[:.]/g, '-');
  const suffix = label ? `-${safeSlug(label)}` : '';
  const file = path.join(dir, `${stamp}-${safeSlug(result.scenario)}${suffix}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return file;
}

async function currentFileHash(file: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await readFile(file)).digest('hex');
  } catch {
    return null;
  }
}

function needsLifecycleEvents(scenario: Scenario): boolean {
  return Boolean(
    scenario.claude.include_hook_events
    || scenario.expect?.permissions
    || scenario.expect?.hooks
    || scenario.regressions?.max_permission_prompts_increase !== undefined
    || scenario.regressions?.max_permission_denied_increase !== undefined
    || scenario.regressions?.require_same_hook_sequence,
  );
}

export function buildClaudeArgs(scenario: Scenario, extraClaudeArgs: string[] = []): string[] {
  const args = ['-p', scenario.prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  if (needsLifecycleEvents(scenario)) args.push('--include-hook-events');
  if (scenario.claude.model) args.push('--model', scenario.claude.model);
  if (scenario.claude.permission_mode) args.push('--permission-mode', scenario.claude.permission_mode);
  if (scenario.claude.max_turns !== undefined) args.push('--max-turns', String(scenario.claude.max_turns));
  if (scenario.claude.max_budget_usd !== undefined) args.push('--max-budget-usd', String(scenario.claude.max_budget_usd));
  args.push(...scenario.claude.args);
  args.push(...extraClaudeArgs);
  return args;
}

export async function filterFixtureChanges(
  worktreePath: string,
  changedFiles: string[],
  fixtureState: Record<string, string | null> = {},
): Promise<string[]> {
  const filtered: string[] = [];
  for (const relative of changedFiles) {
    if (!(relative in fixtureState)) {
      filtered.push(relative);
      continue;
    }
    const expected = fixtureState[relative];
    const current = await currentFileHash(path.join(worktreePath, relative));
    if (current !== expected) filtered.push(relative);
  }
  return filtered;
}

export async function runScenario(scenario: Scenario, options: RunOptions = {}): Promise<RunResult> {
  const invocationDir = options.cwd ?? process.cwd();
  const repoRoot = await getRepoRoot(invocationDir);
  if (!options.allowDirtyWorkingTree) {
    const trackedChanges = await getTrackedChanges(repoRoot);
    if (trackedChanges.length > 0) {
      throw new Error('Canary requires a clean tracked working tree so every run starts from the same commit. Commit or stash tracked changes first.');
    }
  }

  const requestedRef = options.gitRefOverride ?? 'HEAD';
  const gitCommit = await resolveCommit(repoRoot, requestedRef);
  const worktree = await createDetachedWorktree(repoRoot, gitCommit);
  const started = Date.now();
  const setup: CommandSummary[] = [];
  const verification: CommandSummary[] = [];
  const failures: string[] = [];
  const executable = options.executableOverride ?? scenario.claude.executable;
  let prepared: PreparedRun | undefined;

  try {
    prepared = options.prepareWorktree ? await options.prepareWorktree(worktree.path) : undefined;

    let setupOk = true;
    for (const command of scenario.setup?.commands ?? []) {
      const processResult = await runShellCommand(command, worktree.path);
      setup.push(summarize(command, processResult));
      if (processResult.code !== 0) {
        failures.push(`Setup command failed (${processResult.code}): ${command}`);
        setupOk = false;
        break;
      }
    }

    let claudeResult: ProcessResult = {
      code: 1,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
    };

    if (setupOk) {
      const args = buildClaudeArgs(scenario, prepared?.extraClaudeArgs ?? []);

      claudeResult = await spawnCapture(executable, args, {
        cwd: worktree.path,
        timeoutMs: scenario.claude.timeout_seconds * 1000,
        env: { ...process.env, ...scenario.claude.env, ...prepared?.env },
      });

      if (claudeResult.timedOut) failures.push(`Claude timed out after ${scenario.claude.timeout_seconds}s`);
      if (claudeResult.outputTruncated) failures.push('Claude output exceeded Canary\'s 16 MiB capture limit; refusing to evaluate incomplete stream-json output.');
      if (claudeResult.code !== 0) failures.push(`Claude exited with code ${claudeResult.code}`);
    }

    const metrics = parseStreamMetrics(claudeResult.stdout);
    if (setupOk && metrics.parseErrors > 0) {
      failures.push(`Claude stream-json contained ${metrics.parseErrors} malformed non-empty line${metrics.parseErrors === 1 ? '' : 's'}; metrics and assertions would be unreliable.`);
    }

    if (setupOk) {
      for (const command of scenario.verify?.commands ?? []) {
        const processResult = await runShellCommand(command, worktree.path);
        verification.push(summarize(command, processResult));
        if (processResult.code !== 0) failures.push(`Verification command failed (${processResult.code}): ${command}`);
      }
    }

    const rawChangedFiles = await getChangedFiles(worktree.path);
    const changedFiles = await filterFixtureChanges(worktree.path, rawChangedFiles, prepared?.fixtureState);
    const claudeOutput = `${claudeResult.stdout}\n${claudeResult.stderr}`;
    failures.push(...await evaluateExpectations(scenario, worktree.path, changedFiles, metrics, claudeOutput));

    const result: RunResult = {
      schemaVersion: 1,
      scenario: scenario.name,
      executable,
      passed: failures.length === 0,
      failures,
      claudeExitCode: claudeResult.code,
      claudeTimedOut: claudeResult.timedOut,
      durationMs: Date.now() - started,
      changedFiles,
      setup,
      verification,
      metrics,
      createdAt: new Date().toISOString(),
      gitCommit,
    };

    result.artifactPath = await writeArtifact(repoRoot, result, options.artifactLabel);
    return result;
  } finally {
    try {
      await prepared?.cleanup?.();
    } finally {
      await worktree.cleanup();
    }
  }
}
