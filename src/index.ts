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

const program = new Command();
program
  .name('cc-canary')
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
  .description('Compare the same scenario across two Claude executables')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .requiredOption('--baseline <path>', 'known baseline Claude executable')
  .requiredOption('--candidate <path>', 'candidate Claude executable')
  .option('--json', 'print JSON instead of the human report', false)
  .action(async (scenarioPath: string, options: { baseline: string; candidate: string; json: boolean }) => {
    const scenario = await loadScenario(scenarioPath);
    const baseline = await runScenario(scenario, { executableOverride: options.baseline, artifactLabel: 'baseline' });
    const candidate = await runScenario(scenario, { executableOverride: options.candidate, artifactLabel: 'candidate' });
    console.log(options.json ? JSON.stringify({ baseline, candidate }, null, 2) : formatComparison(baseline, candidate));
    if (baseline.passed && !candidate.passed) process.exitCode = 1;
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
