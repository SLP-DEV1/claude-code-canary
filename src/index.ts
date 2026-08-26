#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { bisectCommands } from './bisect.js';
import { loadScenario } from './config.js';
import { formatDoctor, runDoctor } from './doctor.js';
import { formatComparison, formatRun } from './report.js';
import { runScenario } from './runner.js';
import { DEFAULT_SCENARIO } from './template.js';
import { cachedClaudePath, installClaudeVersion, listCachedClaudeVersions, platformId } from './versions.js';

const program = new Command();
program
  .name('claude-canary')
  .description('Regression testing, comparison and bisect tooling for Claude Code')
  .version('0.1.0');

program.command('init')
  .description('Create a starter Canary scenario')
  .argument('[path]', 'scenario path', '.canary/basic.canary.yml')
  .option('-f, --force', 'overwrite an existing scenario', false)
  .action(async (target: string, options: { force: boolean }) => {
    const resolved = path.resolve(target);
    if (!options.force) {
      try {
        await access(resolved);
        throw new Error(`${target} already exists. Use --force to overwrite it.`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) throw error;
      }
    }
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, DEFAULT_SCENARIO, 'utf8');
    if (path.basename(path.dirname(resolved)) === '.canary') {
      const ignorePath = path.join(path.dirname(resolved), '.gitignore');
      try { await access(ignorePath); } catch { await writeFile(ignorePath, 'results/\n', 'utf8'); }
    }
    console.log(`Created ${target}`);
  });

program.command('validate')
  .description('Validate a Canary scenario without running Claude')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .action(async (scenarioPath: string) => {
    const scenario = await loadScenario(scenarioPath);
    console.log(`✓ ${scenarioPath} is valid (${scenario.name})`);
  });

program.command('run')
  .description('Run a scenario once in an isolated Git worktree')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .option('-e, --executable <path>', 'override Claude executable')
  .option('--json', 'print JSON instead of the human report', false)
  .action(async (scenarioPath: string, options: { executable?: string; json: boolean }) => {
    const scenario = await loadScenario(scenarioPath);
    const result = await runScenario(scenario, { executableOverride: options.executable });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatRun(result));
    if (!result.passed) process.exitCode = 1;
  });

program.command('compare')
  .description('Compare the same scenario across two Claude executables or releases')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .option('--baseline <path>', 'known baseline Claude executable')
  .option('--candidate <path>', 'candidate Claude executable')
  .option('--from <version>', 'baseline Claude Code release (x.y.z, stable, latest)')
  .option('--to <version>', 'candidate Claude Code release (x.y.z, stable, latest)')
  .option('--json', 'print JSON instead of the human report', false)
  .action(async (scenarioPath: string, options: { baseline?: string; candidate?: string; from?: string; to?: string; json: boolean }) => {
    const scenario = await loadScenario(scenarioPath);
    let baselineExecutable = options.baseline;
    let candidateExecutable = options.candidate;
    let baselineLabel = 'baseline';
    let candidateLabel = 'candidate';

    if (options.from !== undefined || options.to !== undefined) {
      if (!options.from || !options.to) throw new Error('Use --from and --to together.');
      if (options.baseline || options.candidate) throw new Error('Use either --baseline/--candidate executables or --from/--to releases, not both.');
      const onStatus = (message: string) => console.error(message);
      const baselineInstall = await installClaudeVersion(options.from, { onStatus });
      const candidateInstall = await installClaudeVersion(options.to, { onStatus });
      baselineExecutable = baselineInstall.executablePath;
      candidateExecutable = candidateInstall.executablePath;
      baselineLabel = baselineInstall.version;
      candidateLabel = candidateInstall.version;
    }

    if (!baselineExecutable || !candidateExecutable) {
      throw new Error('Compare requires --baseline <path> and --candidate <path>, or --from <version> and --to <version>.');
    }

    const baseline = await runScenario(scenario, { executableOverride: baselineExecutable, artifactLabel: baselineLabel });
    const candidate = await runScenario(scenario, { executableOverride: candidateExecutable, artifactLabel: candidateLabel });
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
  console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
