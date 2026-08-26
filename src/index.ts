#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { loadScenario, validateScenario } from './config.js';
import { runScenario } from './runner.js';
import { formatComparison, formatRun } from './report.js';
import { bisectCommands } from './bisect.js';
import { runDoctor, formatDoctor } from './doctor.js';
import { createDefaultScenario } from './template.js';
import {
  cachedClaudePath,
  installClaudeVersion,
  listCachedClaudeVersions,
  platformId,
} from './versions.js';

const program = new Command();

program
  .name('cc-canary')
  .description('Regression testing, comparison and bisect tooling for Claude Code')
  .version('0.1.0');

program.command('init')
  .description('Create .canary/basic.canary.yml in the current repository')
  .action(async () => {
    const target = path.join(process.cwd(), '.canary', 'basic.canary.yml');
    await createDefaultScenario(target);
    console.log(`Created ${path.relative(process.cwd(), target)}`);
  });

program.command('validate')
  .description('Validate a Canary scenario without invoking Claude Code')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .action(async (scenarioPath: string) => {
    const scenario = await loadScenario(scenarioPath);
    validateScenario(scenario);
    console.log(`Valid: ${scenario.name}`);
  });

program.command('run')
  .description('Run a scenario once in an isolated Git worktree')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .option('-e, --executable <path>', 'Claude executable override')
  .option('--json', 'print JSON result')
  .action(async (scenarioPath: string, options: { executable?: string; json?: boolean }) => {
    const scenario = await loadScenario(scenarioPath);
    const result = await runScenario(scenario, {
      repositoryRoot: process.cwd(),
      executable: options.executable,
    });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatRun(result));
    if (!result.passed) process.exitCode = 1;
  });

program.command('compare')
  .description('Run the same scenario against two executables or cached Claude Code releases')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .option('--baseline <path>', 'baseline Claude executable')
  .option('--candidate <path>', 'candidate Claude executable')
  .option('--from <version>', 'baseline cached/downloaded release: x.y.z, stable, or latest')
  .option('--to <version>', 'candidate cached/downloaded release: x.y.z, stable, or latest')
  .option('--platform <id>', 'override release platform id for --from/--to')
  .option('--json', 'print JSON result')
  .action(async (scenarioPath: string, options: {
    baseline?: string;
    candidate?: string;
    from?: string;
    to?: string;
    platform?: string;
    json?: boolean;
  }) => {
    const usingPaths = Boolean(options.baseline || options.candidate);
    const usingVersions = Boolean(options.from || options.to);
    if (usingPaths && usingVersions) throw new Error('Use either --baseline/--candidate or --from/--to, not both.');

    let baselineExecutable: string;
    let candidateExecutable: string;
    if (usingVersions) {
      if (!options.from || !options.to) throw new Error('--from and --to must be provided together.');
      const baselineInstall = await installClaudeVersion(options.from, { platform: options.platform, onStatus: (message) => console.error(message) });
      const candidateInstall = await installClaudeVersion(options.to, { platform: options.platform, onStatus: (message) => console.error(message) });
      baselineExecutable = baselineInstall.executablePath;
      candidateExecutable = candidateInstall.executablePath;
    } else {
      if (!options.baseline || !options.candidate) throw new Error('--baseline and --candidate must be provided together.');
      baselineExecutable = options.baseline;
      candidateExecutable = options.candidate;
    }

    const scenario = await loadScenario(scenarioPath);
    const baseline = await runScenario(scenario, { repositoryRoot: process.cwd(), executable: baselineExecutable });
    const candidate = await runScenario(scenario, { repositoryRoot: process.cwd(), executable: candidateExecutable });
    console.log(options.json ? JSON.stringify({ baseline, candidate }, null, 2) : formatComparison(baseline, candidate));
    if (!candidate.passed) process.exitCode = 1;
  });

program.command('bisect')
  .description('Find the first bad executable in an ordered list')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .requiredOption('--commands <commands...>', 'ordered executables, first good and last bad')
  .action(async (scenarioPath: string, options: { commands: string[] }) => {
    const scenario = await loadScenario(scenarioPath);
    const result = await bisectCommands(scenario, options.commands, process.cwd());
    console.log('Claude Code Canary — bisect\n');
    for (const [index, run] of [...result.runs.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`${run.passed ? 'PASS' : 'FAIL'}  [${index}] ${options.commands[index]}`);
    }
    console.log(`\nFirst bad executable: [${result.firstBadIndex}] ${result.firstBadCommand}`);
  });

const versions = program.command('versions').description('Manage isolated cached Claude Code releases');

versions.command('install')
  .description('Download and authenticate a Claude Code release into Canary cache')
  .argument('<version>', 'x.y.z, stable, or latest')
  .option('--platform <id>', 'override release platform id')
  .action(async (version: string, options: { platform?: string }) => {
    const installed = await installClaudeVersion(version, { platform: options.platform, onStatus: (message) => console.error(message) });
    const trust = installed.manifestVerification === 'signed'
      ? `manifest signed ${installed.signingFingerprint}`
      : 'manifest checksum-only (release predates 2.1.89 signatures)';
    console.log(`${installed.cached ? 'Cached' : 'Installed'} ${installed.version} (${installed.platform})\n${installed.executablePath}\nsha256 ${installed.checksum}\n${trust}`);
  });

versions.command('list')
  .description('List Claude Code releases cached for this platform')
  .option('--platform <id>', 'override release platform id')
  .action(async (options: { platform?: string }) => {
    const targetPlatform = options.platform ?? platformId();
    const cached = await listCachedClaudeVersions({ platform: targetPlatform });
    if (cached.length === 0) {
      console.log(`No Claude Code releases cached for ${targetPlatform}.`);
      return;
    }
    console.log(`Cached Claude Code releases (${targetPlatform}):`);
    for (const version of cached) console.log(`  ${version}`);
  });

versions.command('path')
  .description('Print the executable path for an exact cached release')
  .argument('<version>', 'exact x.y.z version')
  .option('--platform <id>', 'override release platform id')
  .action(async (version: string, options: { platform?: string }) => {
    console.log(await cachedClaudePath(version, { platform: options.platform }));
  });

program.command('doctor')
  .description('Check local prerequisites and repository readiness')
  .option('-e, --executable <path>', 'Claude executable', 'claude')
  .action(async (options: { executable: string }) => {
    const checks = await runDoctor(process.cwd(), options.executable);
    console.log(formatDoctor(checks));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`cc-canary: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
