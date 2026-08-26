import type { Scenario } from './config.js';
import { runScenario } from './runner.js';
import type { RunResult } from './types.js';

export interface BisectResult {
  firstBadIndex: number;
  firstBadCommand: string;
  runs: Map<number, RunResult>;
}

export async function bisectCommands(
  scenario: Scenario,
  commands: string[],
  cwd?: string,
): Promise<BisectResult> {
  if (commands.length < 2) throw new Error('Bisect needs at least two ordered executables: a known-good first entry and known-bad last entry.');
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

  const good = await runAt(0);
  if (!good.passed) throw new Error(`Bisect precondition failed: first executable is not good: ${commands[0]}`);

  const bad = await runAt(commands.length - 1);
  if (bad.passed) throw new Error(`Bisect precondition failed: last executable is not bad: ${commands[commands.length - 1]}`);

  let low = 0;
  let high = commands.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const result = await runAt(mid);
    if (result.passed) low = mid;
    else high = mid;
  }

  return { firstBadIndex: high, firstBadCommand: commands[high], runs };
}
