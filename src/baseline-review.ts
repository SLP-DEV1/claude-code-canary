import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { defaultBaselinePath, loadBaseline, updateBaseline, type BaselineSnapshot } from './baseline.js';
import { getRepoRoot } from './git.js';

export interface BaselineProposal {
  schemaVersion: 1;
  scenario: string;
  targetPath: string;
  proposalPath: string;
  previous?: BaselineSnapshot;
  proposed: BaselineSnapshot;
  markdown: string;
}

function pct(previous: number, next: number): string {
  if (previous === 0) return next === 0 ? '0.0%' : '+∞';
  const value = ((next - previous) / previous) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatProposal(previous: BaselineSnapshot | undefined, proposed: BaselineSnapshot, targetPath: string, proposalPath: string): string {
  const lines = [
    `# Claude Canary baseline proposal — ${proposed.scenario}`,
    '',
    `**Target:** \`${targetPath.replace(/\\/g, '/')}\``,
    `**Proposal:** \`${proposalPath.replace(/\\/g, '/')}\``,
    `**Scenario hash:** \`${proposed.scenarioHash}\``,
    `**Source commit:** \`${proposed.gitCommit}\``,
    '',
    '| Metric | Previous | Proposed | Delta |',
    '| --- | ---: | ---: | ---: |',
  ];
  const metrics: Array<[string, number | undefined, number]> = [
    ['Total tokens', previous?.metrics.totalTokens, proposed.metrics.totalTokens],
    ['Input tokens', previous?.metrics.inputTokens, proposed.metrics.inputTokens],
    ['Output tokens', previous?.metrics.outputTokens, proposed.metrics.outputTokens],
    ['Tool calls', previous?.metrics.toolCalls, proposed.metrics.toolCalls],
    ['Duration ms', previous?.durationMs, proposed.durationMs],
  ];
  for (const [name, oldValue, newValue] of metrics) {
    lines.push(`| ${name} | ${oldValue ?? '—'} | ${newValue} | ${oldValue === undefined ? '—' : pct(oldValue, newValue)} |`);
  }
  lines.push('', 'This command does **not** mutate the committed baseline. Review the proposal, then apply it explicitly.');
  return `${lines.join('\n')}\n`;
}

export async function proposeBaselineUpdate(
  scenarioPath: string,
  options: { cwd?: string; executableOverride?: string; target?: string } = {},
): Promise<BaselineProposal> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = await getRepoRoot(cwd);
  const outputDir = path.join(repoRoot, '.canary', 'results', 'baseline-proposals');
  await mkdir(outputDir, { recursive: true });
  const tempName = `${path.basename(scenarioPath).replace(/[^A-Za-z0-9._-]/g, '-')}-${Date.now()}.json`;
  const proposalPath = path.join(outputDir, tempName);
  const update = await updateBaseline(scenarioPath, {
    cwd,
    output: path.relative(cwd, proposalPath),
    executableOverride: options.executableOverride,
  });
  const targetPath = options.target
    ? path.resolve(cwd, options.target)
    : defaultBaselinePath(repoRoot, update.snapshot.scenario);
  let previous: BaselineSnapshot | undefined;
  try { previous = await loadBaseline(targetPath); } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ENOENT')) throw error;
    }
  }
  const markdown = formatProposal(previous, update.snapshot, path.relative(repoRoot, targetPath), path.relative(repoRoot, proposalPath));
  return {
    schemaVersion: 1,
    scenario: update.snapshot.scenario,
    targetPath,
    proposalPath,
    previous,
    proposed: update.snapshot,
    markdown,
  };
}

export async function applyBaselineProposal(proposalPath: string, targetPath: string): Promise<BaselineSnapshot> {
  const proposal = await loadBaseline(proposalPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(proposalPath, targetPath);
  return proposal;
}
