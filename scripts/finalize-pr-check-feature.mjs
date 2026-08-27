import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(file, from, to) {
  const source = await readFile(file, 'utf8');
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one integration anchor, found ${count}`);
  await writeFile(file, source.replace(from, to), 'utf8');
}

await replaceOnce(
  'src/index.ts',
  "import { access, mkdir, writeFile } from 'node:fs/promises';",
  "import { access, mkdir, readFile, writeFile } from 'node:fs/promises';",
);
await replaceOnce(
  'src/index.ts',
  "import { bisectCommands, bisectReleases } from './bisect.js';",
  "import { checkBaseline, updateBaseline } from './baseline.js';\nimport { bisectCommands, bisectReleases } from './bisect.js';",
);
await replaceOnce(
  'src/index.ts',
  "import { formatComparison, formatRun } from './report.js';",
  "import { runPrCheck } from './pr-check.js';\nimport { formatComparison, formatRun } from './report.js';",
);

const commands = [
  "program.command('pr-check')",
  "  .description('Compare the same scenario across two Git refs with one Claude executable')",
  "  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')",
  "  .option('--base <ref>', 'baseline Git ref', 'origin/main')",
  "  .option('--head <ref>', 'candidate Git ref', 'HEAD')",
  "  .option('-e, --executable <path>', 'override Claude executable for both refs')",
  "  .option('--json', 'print JSON instead of the Markdown report', false)",
  "  .action(async (scenarioPath: string, options: { base: string; head: string; executable?: string; json: boolean }) => {",
  "    const scenario = await loadScenario(scenarioPath);",
  "    const result = await runPrCheck(scenario, {",
  "      cwd: process.cwd(),",
  "      baseRef: options.base,",
  "      headRef: options.head,",
  "      executableOverride: options.executable,",
  "    });",
  "    if (options.json) console.log(JSON.stringify(result, null, 2));",
  "    else console.log((await readFile(result.reportPath, 'utf8')).trimEnd() + '\\n\\nReport: ' + result.reportPath);",
  "    if (!result.passed) process.exitCode = 1;",
  "  });",
  "",
  "const baselineCommand = program.command('baseline')",
  "  .description('Create and check committed known-good metric baselines');",
  "",
  "baselineCommand.command('update')",
  "  .description('Run a passing scenario and save its reviewed metric baseline')",
  "  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')",
  "  .option('-o, --output <path>', 'baseline JSON path')",
  "  .option('-e, --executable <path>', 'override Claude executable')",
  "  .option('--json', 'print JSON result', false)",
  "  .action(async (scenarioPath: string, options: { output?: string; executable?: string; json: boolean }) => {",
  "    const result = await updateBaseline(scenarioPath, {",
  "      cwd: process.cwd(),",
  "      output: options.output,",
  "      executableOverride: options.executable,",
  "    });",
  "    if (options.json) console.log(JSON.stringify(result, null, 2));",
  "    else {",
  "      const lines = [",
  "        'Claude Code Canary — baseline updated',",
  "        '',",
  "        'Scenario: ' + result.snapshot.scenario,",
  "        'Baseline: ' + result.baselinePath,",
  "        'Source commit: ' + result.snapshot.gitCommit,",
  "        'Total tokens: ' + result.snapshot.metrics.totalTokens.toLocaleString('en-US'),",
  "        'Tool calls: ' + result.snapshot.metrics.toolCalls,",
  "      ];",
  "      console.log(lines.join('\\n'));",
  "    }",
  "  });",
  "",
  "baselineCommand.command('check')",
  "  .description('Run once and compare against a committed known-good metric baseline')",
  "  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')",
  "  .option('--baseline <path>', 'baseline JSON path (default: .canary/baselines/<scenario-name>.json)')",
  "  .option('-e, --executable <path>', 'override Claude executable')",
  "  .option('--json', 'print JSON instead of the Markdown report', false)",
  "  .action(async (scenarioPath: string, options: { baseline?: string; executable?: string; json: boolean }) => {",
  "    const result = await checkBaseline(scenarioPath, {",
  "      cwd: process.cwd(),",
  "      baseline: options.baseline,",
  "      executableOverride: options.executable,",
  "    });",
  "    if (options.json) console.log(JSON.stringify(result, null, 2));",
  "    else console.log((await readFile(result.reportPath, 'utf8')).trimEnd() + '\\n\\nReport: ' + result.reportPath);",
  "    if (!result.passed) process.exitCode = 1;",
  "  });",
  "",
].join('\n');
await replaceOnce('src/index.ts', "program.command('experiment')", `${commands}\nprogram.command('experiment')`);

await replaceOnce(
  'README.md',
  'The v1 Action supports `compare`, `run`, `plugin-matrix` and `plugin-suite` through one Marketplace-ready `action.yml`.',
  'The v1 Action supports `compare`, `run`, `pr-check`, `baseline-check`, `plugin-matrix` and `plugin-suite` through one Marketplace-ready `action.yml`. `pr-check` can also update one stable pull-request comment with the regression table when `comment-pr: true` is enabled.',
);
const readmeCore = [
  '### Gate a pull request',
  '',
  'Run the same scenario against the base and head Git refs with one Claude executable:',
  '',
  '```bash',
  'claude-canary pr-check .canary/basic.canary.yml \\',
  '  --base origin/main \\',
  '  --head HEAD',
  '```',
  '',
  'This catches repository changes that keep the final task green but increase tokens/cost/tool calls, introduce permission prompts, or change configured hook semantics. See [Pull request regression checks](docs/PR_CHECKS.md).',
  '',
  '### Check a committed baseline with one Claude run',
  '',
  '```bash',
  'claude-canary baseline update .canary/basic.canary.yml',
  '# commit .canary/baselines/<scenario-name>.json',
  'claude-canary baseline check .canary/basic.canary.yml',
  '```',
  '',
  'Baselines use the same regression thresholds while cutting recurring CI from two Claude runs to one. A SHA-256 of the scenario prevents stale snapshots from silently passing after the scenario changes. See [Committed baselines](docs/BASELINES.md).',
  '',
].join('\n');
await replaceOnce('README.md', '### Compare two Claude Code releases\n', `${readmeCore}### Compare two Claude Code releases\n`);
await replaceOnce(
  'README.md',
  'compare          Compare two executables or releases\n',
  'compare          Compare two executables or releases\npr-check         Compare one Claude executable across two Git refs\nbaseline         Create/check committed known-good metric baselines\n',
);
await replaceOnce(
  'README.md',
  '| [GitHub Action](docs/GITHUB_ACTION.md) | Marketplace usage, modes, inputs, outputs and CI security |\n',
  '| [GitHub Action](docs/GITHUB_ACTION.md) | Marketplace usage, modes, inputs, outputs and CI security |\n| [Pull request checks](docs/PR_CHECKS.md) | Base-vs-head regression gates and optional stable PR comments |\n| [Committed baselines](docs/BASELINES.md) | One-run CI against reviewed known-good metrics |\n',
);
await replaceOnce(
  'README.md',
  '| "Did agent usage blow up?" | Track tool calls, tokens, duration and reported cost. |\n',
  '| "Did agent usage blow up?" | Track tool calls, tokens, duration and reported cost. |\n| "Did this PR make the agent worse?" | Compare base vs head with the same Claude executable and fail on configured deltas. |\n| "Can CI do this without paying for two runs every time?" | Commit a known-good metric baseline and execute only the candidate. |\n',
);

await replaceOnce(
  'CHANGELOG.md',
  '- automatically enable Claude Code hook-event streaming when hook assertions or hook-sequence comparisons require it\n',
  '- automatically enable Claude Code hook-event streaming when hook assertions or hook-sequence comparisons require it\n- add `pr-check` for same-Claude base-vs-head Git regression reports with Markdown/JSON output\n- add committed, scenario-hash-protected metric baselines so recurring CI can compare with one Claude run\n- add `pr-check` / `baseline-check` GitHub Action modes, shallow-checkout PR SHA hydration, and opt-in stable PR report comments\n',
);

console.log('PR-check/baseline CLI and docs integration patched successfully.');
