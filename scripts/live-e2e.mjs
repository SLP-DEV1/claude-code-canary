#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] ?? 'core';
if (!['core', 'full'].includes(mode)) {
  console.error('Usage: node scripts/live-e2e.mjs [core|full]');
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cli = path.join(repoRoot, 'dist', 'index.js');
const claude = process.env.CLAUDE_CANARY_E2E_CLAUDE || 'claude';
const keep = process.env.CLAUDE_CANARY_E2E_KEEP === '1';
const requestedDir = process.env.CLAUDE_CANARY_E2E_DIR;
const ownsWorkRoot = !requestedDir;
const workRoot = requestedDir
  ? path.resolve(requestedDir)
  : await mkdtemp(path.join(tmpdir(), 'claude-canary-live-e2e-'));
const fixture = path.join(workRoot, 'fixture');
if (fixture === repoRoot || repoRoot.startsWith(`${fixture}${path.sep}`)) {
  throw new Error('Refusing to place the disposable live E2E fixture over the Claude Canary source repository.');
}

function printable(command, args) {
  return [command, ...args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function run(command, args, { cwd = repoRoot, expectFailure = false, env = {} } = {}) {
  console.log(`\n$ ${printable(command, args)}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  const failed = result.status !== 0;
  if (expectFailure ? !failed : failed) {
    throw new Error(`${printable(command, args)} ${expectFailure ? 'unexpectedly succeeded' : `failed with exit code ${result.status}`}`);
  }
  return result;
}

function canary(args, options = {}) {
  return run(process.execPath, [cli, ...args], { cwd: fixture, ...options });
}

async function write(relative, content) {
  const target = path.join(fixture, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function makeFixture() {
  await mkdir(workRoot, { recursive: true });
  await rm(fixture, { recursive: true, force: true });
  await mkdir(fixture, { recursive: true });

  const modelLine = process.env.CLAUDE_CANARY_E2E_MODEL
    ? `    model: ${JSON.stringify(process.env.CLAUDE_CANARY_E2E_MODEL)}\n`
    : '';

  await write('README.md', '# Claude Canary live E2E fixture\n\nThis repository is disposable and exists only for live compatibility tests.\n');
  await write('seed.txt', 'seed\n');
  await write('.claude/settings.json', `${JSON.stringify({ permissions: { allow: ['Read', 'Write', 'Edit'] } }, null, 2)}\n`);
  await write('.canary/.gitignore', 'results/\nrecordings/\nrepro-live/\nplugins/\n');
  await write('.canary/live.canary.yml', `version: 1\nname: live-claude-e2e\nprompt: |\n  Create a file named result.txt in the repository root containing exactly the single line CANARY_OK.\n  Do not modify, delete, or create any other repository file.\nclaude:\n  executable: claude\n${modelLine}  permission_mode: bypassPermissions\n  max_turns: 10\n  timeout_seconds: 240\nverify:\n  commands:\n    - node -e \"const fs=require('fs'); const v=fs.readFileSync('result.txt','utf8').trim(); if(v!=='CANARY_OK') process.exit(1)\"\nexpect:\n  changed_files:\n    allow:\n      - result.txt\n    require:\n      - result.txt\n    deny: []\n  files_exist:\n    - result.txt\n  file_contains:\n    - path: result.txt\n      text: CANARY_OK\nlimits:\n  max_tool_calls: 20\n  max_total_tokens: 120000\n`);

  await write('variants/baseline/CLAUDE.md', 'For this test, follow the user request exactly and make the smallest possible change.\n');
  await write('variants/candidate/CLAUDE.md', 'For this test, follow the user request exactly and make the smallest possible change.\n');

  await write('test-plugin/.claude-plugin/plugin.json', `${JSON.stringify({ name: 'live-e2e' }, null, 2)}\n`);
  await write('test-plugin/commands/ping.md', `---\ndescription: Harmless live E2E command\n---\nRead README.md and respond with the marker LIVE_E2E_PLUGIN_OK plus a one-line summary. Do not modify files.\n`);

  run('git', ['init'], { cwd: fixture });
  run('git', ['config', 'user.name', 'Claude Canary E2E'], { cwd: fixture });
  run('git', ['config', 'user.email', 'claude-canary-e2e@example.invalid'], { cwd: fixture });
  run('git', ['config', 'commit.gpgsign', 'false'], { cwd: fixture });
  run('git', ['add', '.'], { cwd: fixture });
  run('git', ['commit', '-m', 'live e2e fixture'], { cwd: fixture });
}

async function tuneLivePluginScenarios() {
  const pluginSuite = path.join(fixture, '.canary', 'plugins', 'live-e2e');
  const entries = await readdir(pluginSuite, { withFileTypes: true });
  let tuned = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.canary.yml')) continue;
    const target = path.join(pluginSuite, entry.name);
    const raw = await readFile(target, 'utf8');
    const updated = raw.replace(/max_total_tokens:\s*80000\b/g, 'max_total_tokens: 200000');
    if (updated !== raw) {
      await writeFile(target, updated, 'utf8');
      tuned += 1;
    }
  }

  if (tuned === 0) {
    throw new Error('Expected plugin-init to generate at least one scenario with the standard 80000-token guardrail.');
  }
  console.log(`\nAdjusted ${tuned} generated live plugin scenario(s) to a 200000-token E2E budget.`);
}

async function findFailedArtifact() {
  const resultsDir = path.join(fixture, '.canary', 'results');
  for (const entry of await readdir(resultsDir)) {
    if (!entry.endsWith('.json')) continue;
    const full = path.join(resultsDir, entry);
    try {
      const parsed = JSON.parse(await readFile(full, 'utf8'));
      if (parsed && parsed.passed === false) return full;
    } catch {
      // Ignore non-result JSON artifacts.
    }
  }
  throw new Error('Expected at least one failed Canary result artifact for repro testing.');
}

async function coreSuite() {
  run(claude, ['--version'], { cwd: fixture });
  canary(['doctor', '--executable', claude]);
  canary(['init', '.canary/generated.canary.yml']);
  canary(['validate', '.canary/generated.canary.yml']);
  canary(['validate', '.canary/live.canary.yml']);

  canary(['versions', 'install', 'latest']);
  canary(['versions', 'list']);

  canary(['run', '.canary/live.canary.yml', '--executable', claude]);
  canary(['compare', '.canary/live.canary.yml', '--baseline', claude, '--candidate', claude]);

  canary(['plugin-init', 'test-plugin', '--output', '.canary/plugins/live-e2e']);
  await tuneLivePluginScenarios();
}

async function fullSuite() {
  canary([
    'experiment', '.canary/live.canary.yml',
    '--baseline-config', 'variants/baseline',
    '--candidate-config', 'variants/candidate',
    '--runs', '1',
    '--executable', claude,
  ]);

  // The first executable is known-good; Node itself is intentionally not a Claude executable and is known-bad.
  canary(['bisect', '.canary/live.canary.yml', '--commands', claude, process.execPath]);

  // `init` is deliberately exercised by coreSuite, but `record` intentionally
  // requires a completely clean tree. Remove only that harness-generated file;
  // results/plugins remain ignored and all tracked fixture files stay untouched.
  await rm(path.join(fixture, '.canary', 'generated.canary.yml'), { force: true });

  const recordingPrompt = 'Create recorded.txt in the repository root containing exactly the single line RECORDED_OK. Do not modify any other file.';
  canary(['record', 'live-record', '--prompt', recordingPrompt, '--executable', claude]);
  run(claude, [
    '-p', recordingPrompt,
    '--permission-mode', 'bypassPermissions',
    '--max-turns', '10',
    '--no-session-persistence',
  ], { cwd: fixture });
  canary([
    'save', 'live-record',
    '--output', '.canary/recorded.canary.yml',
    '--verify', `node -e \"const fs=require('fs'); if(fs.readFileSync('recorded.txt','utf8').trim()!=='RECORDED_OK') process.exit(1)\"`,
  ]);
  canary(['replay', '.canary/recorded.canary.yml', '--executable', claude]);

  const failedArtifact = await findFailedArtifact();
  canary(['repro', failedArtifact, '--scenario', '.canary/live.canary.yml', '--output', '.canary/repro-live']);

  canary([
    'plugin-matrix', '.canary/plugins/live-e2e/load.canary.yml',
    '--plugin', 'test-plugin',
    '--last', '1',
  ]);
  canary([
    'plugin-suite',
    '--plugin', 'test-plugin',
    '--suite', '.canary/plugins/live-e2e',
    '--last', '1',
    '--max-runs', '10',
  ]);
}

try {
  await makeFixture();
  await coreSuite();
  if (mode === 'full') await fullSuite();
  console.log(`\nLive Claude E2E (${mode}) passed.`);
  console.log(`Fixture: ${fixture}`);
} catch (error) {
  console.error(`\nLive Claude E2E (${mode}) failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Fixture retained for inspection: ${fixture}`);
  process.exitCode = 1;
} finally {
  if (!keep && process.exitCode !== 1) {
    if (ownsWorkRoot) await rm(workRoot, { recursive: true, force: true });
    else await rm(fixture, { recursive: true, force: true });
  }
}
