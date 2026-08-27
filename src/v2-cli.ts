#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  CompatibilityManifestSchema,
  aggregateRegistryFiles,
  buildCompatibilityGraph,
  checkCanaryLock,
  compatibilityBadgeMarkdown,
  createCanaryLock,
  createCompatibilityManifest,
  explainCompatibility,
  firstKnownBad,
  loadCanaryLock,
  loadCompatibilityManifest,
  loadCompatibilityRegistry,
  newestKnownGood,
  queryCompatibility,
  writeCanaryLock,
  writeCompatibilityManifest,
  writeCompatibilityRegistry,
} from './compatibility.js';
import { applyBaselineProposal, proposeBaselineUpdate } from './baseline-review.js';
import { createBundleAttestation, verifyBundleAttestation, type BundleAttestation } from './attestation.js';
import { CanaryExitCode, exitCodeForSuite, exitCodeForWatch } from './exit-codes.js';
import { analyzeFlakiness } from './flake.js';
import { runGatewayMatrix } from './gateway.js';
import { suiteToJUnit } from './junit.js';
import { createSafeMcpFixture, type SafeMcpFixtureKind } from './mcp-fixtures.js';
import { inspectScenarioPack, installScenarioPack } from './packs.js';
import { generateStaticHtmlReport } from './report-html.js';
import { suiteToSarif } from './sarif.js';
import { analyzeSuiteFlakiness } from './suite-flake.js';
import { combineSuiteResults, explainSuiteSelection, loadSuite, runSuite, type SuiteRunResult } from './suite.js';
import { formatTrendMarkdown, loadTrendPoints, summarizeTrends } from './trend.js';
import { evaluateLifecycleTrust, LifecycleTrustPolicySchema } from './trust.js';
import type { RunResult } from './types.js';
import { CANARY_VERSION } from './version.js';
import { watchClaudeCodeReleases } from './watch.js';

const argv = process.argv.slice(2);

function hasFlag(name: string): boolean { return argv.includes(name); }
function valueAfter(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}
function valueAfterEither(...names: string[]): string | undefined {
  for (const name of names) { const value = valueAfter(name); if (value !== undefined) return value; }
  return undefined;
}
function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
function commaList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
function positional(after = 1): string[] {
  const result: string[] = [];
  for (let i = after; i < argv.length; i += 1) {
    const value = argv[i];
    if (value.startsWith('-')) { if (!['--json','--list','--fail-fast','--reuse-results','--check-only','--allow-unsafe','--force'].includes(value)) i += 1; continue; }
    result.push(value);
  }
  return result;
}
function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function readJson<T = unknown>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }

function rootHelp(): string {
  return `Claude Code Canary ${CANARY_VERSION}\n\n` +
    `Compatibility and regression testing for real Claude Code workflows.\n\n` +
    `New compatibility commands:\n` +
    `  suite <file>                 Run/list/shard a scenario suite\n` +
    `  suite combine <results...>   Combine deterministic shard results\n` +
    `  flake <scenario>             Analyze scenario stability\n` +
    `  flake --suite <file>         Analyze suite stability\n` +
    `  watch --suite <file>         Detect/test new Claude Code releases\n` +
    `  report <results-dir>         Generate a static HTML report\n` +
    `  trend <results-dir>          Summarize local historical trends\n` +
    `  compat <subcommand>          Manifest/registry/query/graph operations\n` +
    `  lock <create|check>          Create/check canary.lock\n` +
    `  pack <inspect|install>       Inspect/install checksummed scenario packs\n` +
    `  gateway-matrix <file>        Run a suite across provider/gateway variants\n` +
    `  mcp-fixture <kind>           Create an isolated MCP fixture\n` +
    `  attest <create|verify>       Hash/sign/verify portable evidence\n` +
    `  trust <run.json>             Evaluate lifecycle trust policy\n` +
    `  baseline propose/apply       Review baseline changes explicitly\n\n` +
    `Existing commands (run, compare, bisect, plugin-suite, mcp-check, doctor, etc.) remain supported.\n`;
}

async function delegateLegacy(): Promise<void> {
  const legacy = path.join(import.meta.dirname, 'index.js');
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [legacy, ...argv], { stdio: 'inherit', env: process.env, cwd: process.cwd(), windowsHide: true });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
  });
  process.exitCode = code;
}

async function suiteCommand(): Promise<void> {
  if (argv[1] === 'combine') {
    const files = positional(2);
    if (!files.length) throw new Error('suite combine requires one or more suite result JSON files.');
    const combined = combineSuiteResults(await Promise.all(files.map((file) => readJson<SuiteRunResult>(file))));
    const output = valueAfter('--output');
    if (output) await writeJson(output, combined);
    console.log(hasFlag('--json') || !output ? JSON.stringify(combined, null, 2) : output);
    process.exitCode = exitCodeForSuite(combined);
    return;
  }
  const suitePath = argv[1] && !argv[1].startsWith('-') ? argv[1] : '.canary/release.suite.yml';
  const suite = await loadSuite(path.resolve(suitePath));
  const options = {
    cwd: process.cwd(),
    tag: valueAfter('--tag'),
    shard: valueAfter('--shard'),
    changedPaths: commaList(valueAfter('--changed')),
  };
  if (hasFlag('--list')) {
    const selection = await explainSuiteSelection(suite, options);
    if (hasFlag('--json')) console.log(JSON.stringify(selection, null, 2));
    else {
      for (const item of selection.selected) console.log(`RUN   ${item.path}${item.tags.length ? ` [${item.tags.join(',')}]` : ''}`);
      for (const item of selection.skipped) console.log(`SKIP  ${item.path} (${item.reason})`);
    }
    return;
  }
  const result = await runSuite(suitePath, {
    ...options,
    concurrency: positiveInt(valueAfter('--concurrency'), '--concurrency'),
    maxRuns: positiveInt(valueAfter('--max-runs'), '--max-runs'),
    failFast: hasFlag('--fail-fast'),
    reuseResults: hasFlag('--reuse-results'),
    executableOverride: valueAfterEither('--executable', '-e'),
  });
  const junit = valueAfter('--junit');
  if (junit) await writeFile(junit, suiteToJUnit(result), 'utf8');
  const sarif = valueAfter('--sarif');
  if (sarif) await writeJson(sarif, suiteToSarif(result));
  console.log(hasFlag('--json') ? JSON.stringify(result, null, 2) : await readFile(result.markdownArtifactPath!, 'utf8'));
  process.exitCode = exitCodeForSuite(result);
}

async function flakeCommand(): Promise<void> {
  const runs = positiveInt(valueAfter('--runs'), '--runs');
  const executableOverride = valueAfterEither('--executable', '-e');
  const suitePath = valueAfter('--suite');
  if (suitePath) {
    const result = await analyzeSuiteFlakiness(suitePath, { runs, executableOverride, concurrency: positiveInt(valueAfter('--concurrency'), '--concurrency') });
    console.log(hasFlag('--json') ? JSON.stringify(result, null, 2) : await readFile(result.markdownArtifactPath!, 'utf8'));
    if (result.classification === 'flaky') process.exitCode = CanaryExitCode.regression;
    return;
  }
  const scenario = argv[1] && !argv[1].startsWith('-') ? argv[1] : '.canary/basic.canary.yml';
  const result = await analyzeFlakiness(scenario, { runs, executableOverride });
  console.log(hasFlag('--json') ? JSON.stringify(result, null, 2) : await readFile(result.markdownArtifactPath!, 'utf8'));
  if (!result.policyPassed) process.exitCode = CanaryExitCode.regression;
}

async function watchCommand(): Promise<void> {
  const suitePath = required(valueAfter('--suite'), '--suite');
  const result = await watchClaudeCodeReleases({
    cwd: process.cwd(), suitePath,
    statePath: valueAfter('--state'), good: valueAfter('--good'), platform: valueAfter('--platform'),
    checkOnly: hasFlag('--check-only'), tag: valueAfter('--tag'), shard: valueAfter('--shard'),
    concurrency: positiveInt(valueAfter('--concurrency'), '--concurrency'),
    onStatus: (message) => console.error(message),
  });
  console.log(hasFlag('--json') ? JSON.stringify(result, null, 2) : await readFile(result.markdownArtifactPath!, 'utf8'));
  process.exitCode = exitCodeForWatch(result.status, result.suite?.infrastructureFailedCount ?? 0);
}

async function reportCommand(): Promise<void> {
  const input = argv[1] && !argv[1].startsWith('-') ? argv[1] : '.canary/results';
  const format = valueAfter('--format') ?? 'html';
  if (format !== 'html') throw new Error('report currently supports --format html.');
  const output = valueAfter('--output') ?? path.join(input, 'html');
  console.log(await generateStaticHtmlReport(input, output, valueAfter('--title')));
}

async function trendCommand(): Promise<void> {
  const input = argv[1] && !argv[1].startsWith('-') ? argv[1] : '.canary/results';
  const summary = summarizeTrends(await loadTrendPoints(input));
  console.log(hasFlag('--json') ? JSON.stringify(summary, null, 2) : formatTrendMarkdown(summary));
}

async function baselineCommand(): Promise<boolean> {
  if (argv[1] === 'propose') {
    const scenario = required(argv[2], 'scenario');
    const result = await proposeBaselineUpdate(scenario, { executableOverride: valueAfterEither('--executable','-e'), target: valueAfter('--target') });
    const markdownPath = `${result.proposalPath}.md`;
    await writeFile(markdownPath, result.markdown, 'utf8');
    console.log(result.markdown + `\nProposal JSON: ${result.proposalPath}\nReview: ${markdownPath}`);
    return true;
  }
  if (argv[1] === 'apply') {
    const proposal = required(argv[2], 'proposal');
    const target = required(valueAfter('--target'), '--target');
    const result = await applyBaselineProposal(proposal, target);
    console.log(`Applied reviewed baseline proposal for ${result.scenario} to ${target}`);
    return true;
  }
  return false;
}

async function compatCommand(): Promise<void> {
  const sub = argv[1];
  if (sub === 'manifest') {
    const evidenceFile = required(argv[2], 'evidence JSON');
    const evidence = await readJson<Record<string, unknown>>(evidenceFile);
    const component = required(valueAfter('--component'), '--component');
    const claudeCode = required(valueAfter('--claude'), '--claude');
    const platform = required(valueAfter('--platform'), '--platform');
    const resultValue = valueAfter('--result') ?? ((evidence as { passed?: boolean }).passed === true ? 'pass' : 'fail');
    const parsedResult = CompatibilityManifestSchema.shape.result.parse(resultValue);
    const fingerprints = Array.isArray((evidence as { failureClusters?: Array<{ fingerprint?: { id?: string } }> }).failureClusters)
      ? (evidence as { failureClusters: Array<{ fingerprint?: { id?: string } }> }).failureClusters.flatMap((item) => item.fingerprint?.id ? [item.fingerprint.id] : []) : [];
    const manifest = createCompatibilityManifest({
      claudeCode, component, componentVersion: valueAfter('--component-version'), platform,
      suiteDefinition: { suite: evidence.suite, suitePath: evidence.suitePath }, result: parsedResult,
      evidence, failureFingerprints: fingerprints,
      metadata: valueAfter('--git-commit') ? { gitCommit: valueAfter('--git-commit')! } : {},
    });
    const output = valueAfter('--output') ?? `${component.replace(/[^A-Za-z0-9._-]/g,'-')}.compat.json`;
    await writeCompatibilityManifest(output, manifest);
    console.log(output);
    return;
  }
  if (sub === 'merge') {
    const output = required(valueAfter('--output'), '--output');
    const files = positional(2);
    const registry = await aggregateRegistryFiles(valueAfter('--name') ?? 'canary-workspace', files);
    await writeCompatibilityRegistry(output, registry); console.log(output); return;
  }
  const registryFile = required(argv[2], 'registry JSON');
  const registry = await loadCompatibilityRegistry(registryFile);
  const query = { component: valueAfter('--component'), componentVersion: valueAfter('--component-version'), platform: valueAfter('--platform') };
  if (sub === 'query') { console.log(JSON.stringify(queryCompatibility(registry, { ...query, claudeCode: valueAfter('--claude'), result: valueAfter('--result') as 'pass'|'fail'|'unsupported'|undefined }), null, 2)); return; }
  if (sub === 'latest-good') { console.log(JSON.stringify(newestKnownGood(registry, { ...query, component: required(query.component, '--component') }) ?? null, null, 2)); return; }
  if (sub === 'first-bad') { console.log(JSON.stringify(firstKnownBad(registry, { ...query, component: required(query.component, '--component') }, valueAfter('--from'), valueAfter('--to')) ?? null, null, 2)); return; }
  if (sub === 'explain') { console.log(JSON.stringify(explainCompatibility(registry, { ...query, component: required(query.component, '--component') }, valueAfter('--from'), valueAfter('--to')), null, 2)); return; }
  if (sub === 'graph') { console.log(JSON.stringify(buildCompatibilityGraph(registry), null, 2)); return; }
  if (sub === 'badge') { const manifest = await loadCompatibilityManifest(registryFile); console.log(compatibilityBadgeMarkdown(manifest)); return; }
  throw new Error('compat subcommand must be manifest, merge, query, latest-good, first-bad, explain, graph, or badge.');
}

async function lockCommand(): Promise<void> {
  const sub = argv[1];
  if (sub === 'create') {
    const files = positional(2); if (!files.length) throw new Error('lock create requires compatibility manifest files.');
    const lock = createCanaryLock(await Promise.all(files.map(loadCompatibilityManifest)));
    const output = valueAfter('--output') ?? 'canary.lock'; await writeCanaryLock(output, lock); console.log(output); return;
  }
  if (sub === 'check') {
    const file = argv[2] && !argv[2].startsWith('-') ? argv[2] : 'canary.lock';
    const lock = await loadCanaryLock(file);
    const manifests = commaList(valueAfter('--manifests')) ?? [];
    const result = checkCanaryLock(lock, {
      claudeCode: valueAfter('--claude') ?? lock.claudeCode,
      platform: valueAfter('--platform') ?? lock.platform,
      manifests: manifests.length ? await Promise.all(manifests.map(loadCompatibilityManifest)) : undefined,
    });
    console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = CanaryExitCode.regression; return;
  }
  throw new Error('lock subcommand must be create or check.');
}

async function packCommand(): Promise<void> {
  const sub = argv[1]; const source = required(argv[2], 'pack directory');
  if (sub === 'inspect') { console.log(JSON.stringify(await inspectScenarioPack(source, { allowUnsafe: hasFlag('--allow-unsafe') }), null, 2)); return; }
  if (sub === 'install') {
    const target = required(valueAfter('--target'), '--target');
    console.log(JSON.stringify(await installScenarioPack(source, target, { allowUnsafe: hasFlag('--allow-unsafe'), force: hasFlag('--force') }), null, 2)); return;
  }
  throw new Error('pack subcommand must be inspect or install.');
}

async function gatewayCommand(): Promise<void> {
  const file = required(argv[1], 'gateway matrix file');
  const result = await runGatewayMatrix(file, { executableOverride: valueAfterEither('--executable','-e'), concurrency: positiveInt(valueAfter('--concurrency'),'--concurrency') });
  console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = CanaryExitCode.regression;
}

async function fixtureCommand(): Promise<void> {
  const kind = required(argv[1], 'fixture kind') as SafeMcpFixtureKind;
  const output = required(valueAfter('--output'), '--output');
  const fixture = await createSafeMcpFixture(kind, { root: output });
  console.log(JSON.stringify({ kind: fixture.kind, root: fixture.root, command: fixture.command, args: fixture.args }, null, 2));
}

async function attestCommand(): Promise<void> {
  const sub = argv[1];
  if (sub === 'create') {
    const root = required(argv[2], 'bundle directory');
    const key = valueAfter('--private-key');
    const attestation = await createBundleAttestation(root, { privateKeyPem: key ? await readFile(key, 'utf8') : undefined, exclude: commaList(valueAfter('--exclude')) });
    const output = valueAfter('--output') ?? path.join(root, 'canary-attestation.json'); await writeJson(output, attestation); console.log(output); return;
  }
  if (sub === 'verify') {
    const root = required(argv[2], 'bundle directory'); const file = required(valueAfter('--attestation'), '--attestation');
    const attestation = await readJson<BundleAttestation>(file); const key = valueAfter('--public-key');
    const result = await verifyBundleAttestation(root, attestation, { publicKeyPem: key ? await readFile(key,'utf8') : undefined });
    console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = CanaryExitCode.regression; return;
  }
  throw new Error('attest subcommand must be create or verify.');
}

async function trustCommand(): Promise<void> {
  const runFile = required(argv[1], 'run result JSON'); const policyFile = required(valueAfter('--policy'), '--policy');
  const result = await readJson<RunResult>(runFile); const policy = LifecycleTrustPolicySchema.parse(YAML.parse(await readFile(policyFile,'utf8')));
  const evaluation = evaluateLifecycleTrust(result, policy); console.log(JSON.stringify(evaluation, null, 2)); if (!evaluation.passed) process.exitCode = CanaryExitCode.regression;
}

async function main(): Promise<void> {
  if (!argv.length || hasFlag('--help') || hasFlag('-h')) { console.log(rootHelp()); return; }
  if (hasFlag('--version') || hasFlag('-V')) { console.log(CANARY_VERSION); return; }
  const command = argv[0];
  if (command === 'suite') return suiteCommand();
  if (command === 'flake') return flakeCommand();
  if (command === 'watch') return watchCommand();
  if (command === 'report') return reportCommand();
  if (command === 'trend') return trendCommand();
  if (command === 'baseline' && await baselineCommand()) return;
  if (command === 'compat') return compatCommand();
  if (command === 'lock') return lockCommand();
  if (command === 'pack') return packCommand();
  if (command === 'gateway-matrix') return gatewayCommand();
  if (command === 'mcp-fixture') return fixtureCommand();
  if (command === 'attest') return attestCommand();
  if (command === 'trust') return trustCommand();
  return delegateLegacy();
}

main().catch((error) => {
  console.error(`claude-canary: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = CanaryExitCode.configuration;
});
