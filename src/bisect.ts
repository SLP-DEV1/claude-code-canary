import type { Scenario } from './config.js';
import { runScenario } from './runner.js';
import type { RunResult } from './types.js';
import { installClaudeVersion } from './versions.js';

export interface BisectResult {
  firstBadIndex: number;
  firstBadCommand: string;
  runs: Map<number, RunResult>;
}

export interface ReleaseBisectResult {
  firstBadIndex: number;
  firstBadVersion: string;
  versions: string[];
  runs: Map<number, RunResult>;
}

export interface ReleaseBisectOptions {
  cwd?: string;
  platform?: string;
  onStatus?: (message: string) => void;
}

export async function findFirstBadIndex(
  itemCount: number,
  runPassed: (index: number) => Promise<boolean>,
  describe: (index: number) => string = (index) => String(index),
): Promise<number> {
  if (itemCount < 2) throw new Error('Bisect needs at least two ordered items: a known-good first entry and known-bad last entry.');

  if (!(await runPassed(0))) {
    throw new Error(`Bisect precondition failed: first item is not good: ${describe(0)}`);
  }
  if (await runPassed(itemCount - 1)) {
    throw new Error(`Bisect precondition failed: last item is not bad: ${describe(itemCount - 1)}`);
  }

  let low = 0;
  let high = itemCount - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await runPassed(mid)) low = mid;
    else high = mid;
  }
  return high;
}

export async function bisectCommands(
  scenario: Scenario,
  commands: string[],
  cwd?: string,
): Promise<BisectResult> {
  const runs = new Map<number, RunResult>();

  const runAt = async (index: number): Promise<RunResult> => {
    const cached = runs.get(index);
    if (cached) return cached;
    const result = await runScenario(scenario, {
      cwd,
      executableOverride: commands[index],
      artifactLabel: `bisect-${index}`,
    });
    runs.set(index, result);
    return result;
  };

  const firstBadIndex = await findFirstBadIndex(
    commands.length,
    async (index) => (await runAt(index)).passed,
    (index) => commands[index],
  );

  return { firstBadIndex, firstBadCommand: commands[firstBadIndex], runs };
}

export async function bisectReleases(
  scenario: Scenario,
  versions: string[],
  options: ReleaseBisectOptions = {},
): Promise<ReleaseBisectResult> {
  const runs = new Map<number, RunResult>();

  const runAt = async (index: number): Promise<RunResult> => {
    const cached = runs.get(index);
    if (cached) return cached;
    const version = versions[index];
    options.onStatus?.(`Preparing Claude Code ${version} for bisect...`);
    const installed = await installClaudeVersion(version, {
      platform: options.platform,
      onStatus: options.onStatus,
    });
    const result = await runScenario(scenario, {
      cwd: options.cwd,
      executableOverride: installed.executablePath,
      artifactLabel: `bisect-${version}`,
    });
    runs.set(index, result);
    return result;
  };

  const firstBadIndex = await findFirstBadIndex(
    versions.length,
    async (index) => (await runAt(index)).passed,
    (index) => versions[index],
  );

  return {
    firstBadIndex,
    firstBadVersion: versions[firstBadIndex],
    versions,
    runs,
  };
}
