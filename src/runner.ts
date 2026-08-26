import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Scenario } from './config.js';
import { evaluateExpectations } from './evaluate.js';
import { createDetachedWorktree, getChangedFiles, getHeadCommit, getRepoRoot, getTrackedChanges } from './git.js';
import { parseStreamMetrics } from './metrics.js';
import { runShellCommand, spawnCapture } from './process.js';
import type { CommandSummary, ProcessResult, RunResult } from './types.js';

interface RunOptions {
  cwd?: string;
  executableOverride?: string;
  artifactLabel?: string;
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

export async function runScenario(scenario: Scenario, options: RunOptions = {}): Promise<RunResult> {
  const invocationDir = options.cwd ?? process.cwd();
  const repoRoot = await getRepoRoot(invocationDir);
  const trackedChanges = await getTrackedChanges(repoRoot);
  if (trackedChanges.length > 0) {
    throw new Error('Canary requires a clean tracked working tree so every run starts from the same commit. Commit or stash tracked changes first.');
  }

  const gitCommit = await getHeadCommit(repoRoot);
  const worktree = await createDetachedWorktree(repoRoot);
  const started = Date.now();
  const setup: CommandSummary[] = [];
  const verification: CommandSummary[] = [];
  const failures: string[] = [];
  const executable = options.executableOverride ?? scenario.claude.executable;

  try {
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
      const args = ['-p', scenario.prompt, '--output-format', 'stream-json', '--no-session-persistence'];
      if (scenario.claude.include_hook_events) args.push('--include-hook-events');
      if (scenario.claude.model) args.push('--model', scenario.claude.model);
      if (scenario.claude.permission_mode) args.push('--permission-mode', scenario.claude.permission_mode);
      if (scenario.claude.max_turns !== undefined) args.push('--max-turns', String(scenario.claude.max_turns));
      if (scenario.claude.max_budget_usd !== undefined) args.push('--max-budget-usd', String(scenario.claude.max_budget_usd));
      args.push(...scenario.claude.args);

      claudeResult = await spawnCapture(executable, args, {
        cwd: worktree.path,
        timeoutMs: scenario.claude.timeout_seconds * 1000,
        env: { ...process.env, ...scenario.claude.env },
      });

      if (claudeResult.timedOut) failures.push(`Claude timed out after ${scenario.claude.timeout_seconds}s`);
      if (claudeResult.code !== 0) failures.push(`Claude exited with code ${claudeResult.code}`);
    }

    const metrics = parseStreamMetrics(claudeResult.stdout);

    if (setupOk) {
      for (const command of scenario.verify?.commands ?? []) {
        const processResult = await runShellCommand(command, worktree.path);
        verification.push(summarize(command, processResult));
        if (processResult.code !== 0) failures.push(`Verification command failed (${processResult.code}): ${command}`);
      }
    }

    const changedFiles = await getChangedFiles(worktree.path);
    failures.push(...await evaluateExpectations(scenario, worktree.path, changedFiles, metrics));

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
    await worktree.cleanup();
  }
}
