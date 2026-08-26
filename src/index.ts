#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { bisectCommands, bisectReleases } from './bisect.js';
import { loadScenario } from './config.js';
import { formatDoctor, runDoctor } from './doctor.js';
import { formatExperiment, runExperiment } from './experiment.js';
import { generatePluginScenarios } from './plugin-init.js';
import { formatPluginMatrixMarkdown, runPluginMatrix } from './plugin-matrix.js';
import { fetchPublishedVersionsBetween } from './release-catalog.js';
import { finishRecording, startRecording } from './record.js';
import { createReproBundle } from './repro.js';
import { formatComparison, formatRun } from './report.js';
import { runScenario } from './runner.js';
import { DEFAULT_SCENARIO } from './template.js';
import { CANARY_VERSION } from './version.js';
import { cachedClaudePath, installClaudeVersion, listCachedClaudeVersions, platformId } from './versions.js';

const program = new Command();
program
  .name('claude-canary')
  .description('Regression testing, comparison and bisect tooling for Claude Code')
  .version(CANARY_VERSION);

function resolveRecordingName(positional?: string, optionName?: string): string {
  if (positional && optionName && positional !== optionName) {
    throw new Error(`Recording name was provided twice with different values: ${positional} and ${optionName}.`);
  }
  const name = positional ?? optionName;
  if (!name) throw new Error('Provide a recording name as an argument or with --name <name>.');
  return name;
}

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

program.command('record')
  .description('Snapshot a clean repository before a real Claude Code task')
  .argument('[name]', 'recording name')
  .option('--name <name>', 'recording name (alternative to positional argument)')
  .requiredOption('--prompt <text>', 'task prompt to save for replay')
  .option('--setup <commands...>', 'portable setup commands to include in generated scenario')
  .option('--verify <commands...>', 'portable verification commands to include in generated scenario')
  .option('-e, --executable <path>', 'Claude executable used for version metadata', 'claude')
  .option('--model <model>', 'model metadata to preserve in the generated scenario')
  .option('-f, --force', 'replace an existing pending recording with the same name', false)
  .action(async (nameArg: string | undefined, options: {
    name?: string;
    prompt: string;
    setup?: string[];
    verify?: string[];
    executable: string;
    model?: string;
    force: boolean;
  }) => {
    const name = resolveRecordingName(nameArg, options.name);
    const state = await startRecording(name, {
      cwd: process.cwd(),
      prompt: options.prompt,
      setupCommands: options.setup,
      verifyCommands: options.verify,
      executable: options.executable,
      model: options.model,
      force: options.force,
    });
    console.log(`Claude Code Canary — recording started\n\nName: ${state.name}\nStart commit: ${state.startCommit}`);
    if (state.claude.version) console.log(`Claude: ${state.claude.version}`);
    if (state.promptRedacted) console.log('Prompt: sensitive token/path patterns were redacted before persistence.');
    console.log(`\nRun the real Claude Code task now, then save it with:\n  claude-canary save ${name}`);
  });

program.command('save')
  .description('Turn a pending recording and the current Git diff into a Canary scenario')
  .argument('[name]', 'recording name')
  .option('--name <name>', 'recording name (alternative to positional argument)')
  .option('--setup <commands...>', 'additional portable setup commands')
  .option('--verify <commands...>', 'additional portable verification commands')
  .option('-o, --output <path>', 'generated scenario path')
  .action(async (nameArg: string | undefined, options: {
    name?: string;
    setup?: string[];
    verify?: string[];
    output?: string;
  }) => {
    const name = resolveRecordingName(nameArg, options.name);
    const result = await finishRecording(name, {
      cwd: process.cwd(),
      output: options.output,
      setupCommands: options.setup,
      verifyCommands: options.verify,
    });
    console.log(`Claude Code Canary — recording saved\n\nScenario: ${result.scenarioPath}\nRecorded commit: ${result.scenario.recording?.git_commit}`);
    console.log(`Required changed files (${result.changedFiles.length}):`);
    for (const file of result.changedFiles) console.log(`  ${file}`);
    console.log(`\nReview/edit the generated assertions, then replay with:\n  claude-canary replay ${result.scenarioPath}`);
  });

program.command('replay')
  .description('Replay a recorded scenario from its original Git commit')
  .argument('[scenario]', 'recorded scenario YAML', '.canary/basic.canary.yml')
  .option('-e, --executable <path>', 'override Claude executable')
  .option('--json', 'print JSON instead of the human report', false)
  .action(async (scenarioPath: string, options: { executable?: string; json: boolean }) => {
    const scenario = await loadScenario(scenarioPath);
    if (!scenario.recording?.git_commit) {
      throw new Error(`${scenarioPath} has no recording.git_commit metadata. Use claude-canary run for ordinary scenarios.`);
    }
    if (scenario.recording.prompt_redacted) {
      console.error('Note: the recorded prompt was redacted for portability/secrets; review the generated prompt before judging replay fidelity.');
    }
    const result = await runScenario(scenario, {
      cwd: process.cwd(),
      executableOverride: options.executable,
      gitRefOverride: scenario.recording.git_commit,
      allowDirtyWorkingTree: true,
      artifactLabel: `replay-${scenario.recording.git_commit.slice(0, 8)}`,
    });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatRun(result));
    if (!result.passed) process.exitCode = 1;
  });

program.command('repro')
  .description('Export a privacy-first reproduction bundle from a failed Canary result')
  .argument('<result>', 'failed .canary/results/*.json artifact')
  .option('--scenario <path>', 'explicit scenario path when automatic lookup is ambiguous')
  .option('-o, --output <path>', 'bundle output directory')
  .option('-f, --force', 'replace an existing bundle directory', false)
  .action(async (resultPath: string, options: { scenario?: string; output?: string; force: boolean }) => {
    const bundle = await createReproBundle(resultPath, {
      cwd: process.cwd(),
      scenarioPath: options.scenario,
      output: options.output,
      force: options.force,
    });
    console.log(`Claude Code Canary — reproduction bundle\n\nOutput: ${bundle.outputPath}\nBase commit: ${bundle.baseCommit}`);
    console.log(`Exported fixture files: ${bundle.exportedFiles.length}`);
    console.log(`Redacted fixture files: ${bundle.redactedFiles.length}`);
    console.log(`Skipped fixture entries: ${bundle.skippedFiles.length}`);
    console.log('\nReview README.md and issue-report.md before publishing the bundle.');
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

program.command('experiment')
  .description('A/B test two Claude Code configuration variants')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .requiredOption('--baseline-config <dir>', 'baseline configuration variant directory')
  .requiredOption('--candidate-config <dir>', 'candidate configuration variant directory')
  .option('--runs <count>', 'runs per variant', '3')
  .option('-e, --executable <path>', 'override Claude executable for both variants')
  .option('--json', 'print JSON instead of the human report', false)
  .action(async (scenarioPath: string, options: { baselineConfig: string; candidateConfig: string; runs: string; executable?: string; json: boolean }) => {
    const scenario = await loadScenario(scenarioPath);
    const runs = Number(options.runs);
    if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error('--runs must be an integer between 1 and 50.');
    const result = await runExperiment(scenario, options.baselineConfig, options.candidateConfig, {
      cwd: process.cwd(),
      runs,
      executableOverride: options.executable,
    });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatExperiment(result));
    if (result.candidate.aggregate.passRate < result.baseline.aggregate.passRate) process.exitCode = 1;
  });

program.command('plugin-init')
  .description('Discover a Claude Code plugin and generate smoke-test scenarios')
  .argument('<plugin>', 'plugin directory')
  .option('-o, --output <dir>', 'output directory (default: .canary/plugins/<plugin-name>)')
  .option('-f, --force', 'replace a previous Canary-generated plugin smoke suite', false)
  .option('--json', 'print generated suite metadata as JSON', false)
  .action(async (pluginPath: string, options: { output?: string; force: boolean; json: boolean }) => {
    const result = await generatePluginScenarios(pluginPath, {
      cwd: process.cwd(),
      output: options.output,
      force: options.force,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Claude Code Canary — plugin smoke suite\n\nPlugin: ${result.pluginName}\nOutput: ${result.outputDir}`);
    console.log(`Commands: ${result.discovery.commands.length}`);
    console.log(`Agents: ${result.discovery.agents.length}`);
    console.log(`Skills: ${result.discovery.skills.length}`);
    console.log(`Hooks: ${result.discovery.hooks.length}`);
    console.log(`MCP servers: ${result.discovery.mcpServers.length}`);
    console.log(`Generated scenarios: ${result.scenarios.length}`);
    if (result.discovery.warnings.length) {
      console.log('\nWarnings:');
      for (const warning of result.discovery.warnings) console.log(`  - ${warning}`);
    }
    console.log(`\nDiscovery: ${result.discoveryPath}`);
    console.log(`Next: claude-canary plugin-matrix ${result.scenarios[0]?.path ?? '<scenario>'} --plugin ${pluginPath} --last 10`);
  });

program.command('plugin-matrix')
  .description('Test one Claude Code plugin across a release matrix')
  .argument('[scenario]', 'deterministic plugin smoke scenario', '.canary/plugin-smoke.canary.yml')
  .requiredOption('--plugin <path>', 'plugin directory')
  .option('--versions <versions...>', 'exact Claude Code releases to test')
  .option('--from <version>', 'oldest exact published release to test')
  .option('--to <version>', 'newest exact published release to test')
  .option('--last <count>', 'test the newest N published releases')
  .option('--platform <id>', 'override release platform id')
  .option('--json', 'print JSON instead of Markdown', false)
  .option('--allow-incompatible', 'do not fail the command when any tested release is incompatible', false)
  .action(async (scenarioPath: string, options: {
    plugin: string;
    versions?: string[];
    from?: string;
    to?: string;
    last?: string;
    platform?: string;
    json: boolean;
    allowIncompatible: boolean;
  }) => {
    const scenario = await loadScenario(scenarioPath);
    const last = options.last === undefined ? undefined : Number(options.last);
    if (options.last !== undefined && (!Number.isInteger(last) || (last ?? 0) < 1)) {
      throw new Error('--last must be a positive integer.');
    }
    const result = await runPluginMatrix(scenario, {
      cwd: process.cwd(),
      pluginPath: options.plugin,
      versions: options.versions,
      from: options.from,
      to: options.to,
      last,
      platform: options.platform,
      onStatus: (message) => console.error(message),
    });
    console.log(options.json ? JSON.stringify(result, null, 2) : formatPluginMatrixMarkdown(result));
    if (!options.json) {
      console.log(`JSON artifact: ${result.jsonArtifactPath}`);
      console.log(`Markdown artifact: ${result.markdownArtifactPath}`);
    }
    if (result.incompatible > 0 && !options.allowIncompatible) process.exitCode = 1;
  });

program.command('bisect')
  .description('Find the first bad Claude Code release or executable')
  .argument('[scenario]', 'scenario YAML', '.canary/basic.canary.yml')
  .option('--commands <commands...>', 'ordered executables, first good and last bad')
  .option('--good <version>', 'known-good published Claude Code version')
  .option('--bad <version>', 'known-bad published Claude Code version')
  .option('--platform <id>', 'override release platform id for --good/--bad mode')
  .action(async (scenarioPath: string, options: { commands?: string[]; good?: string; bad?: string; platform?: string }) => {
    const scenario = await loadScenario(scenarioPath);
    const usingCommands = Boolean(options.commands?.length);
    const usingReleases = Boolean(options.good || options.bad);
    if (usingCommands && usingReleases) throw new Error('Use either --commands or --good/--bad release mode, not both.');

    if (usingReleases) {
      if (!options.good || !options.bad) throw new Error('--good and --bad must be provided together.');
      const versions = await fetchPublishedVersionsBetween(options.good, options.bad);
      console.error(`Bisecting ${versions.length} published Claude Code releases from ${options.good} to ${options.bad}.`);
      const result = await bisectReleases(scenario, versions, {
        cwd: process.cwd(),
        platform: options.platform,
        onStatus: (message) => console.error(message),
      });
      console.log('Claude Code Canary — release bisect\n');
      for (const [index, run] of [...result.runs.entries()].sort((a, b) => a[0] - b[0])) {
        console.log(`${run.passed ? 'PASS' : 'FAIL'}  ${result.versions[index]}`);
      }
      console.log(`\nFirst bad release: ${result.firstBadVersion}`);
      return;
    }

    if (!options.commands || options.commands.length < 2) {
      throw new Error('Bisect requires --good <version> --bad <version>, or --commands <good> ... <bad>.');
    }
    const result = await bisectCommands(scenario, options.commands, process.cwd());
    console.log('Claude Code Canary — executable bisect\n');
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