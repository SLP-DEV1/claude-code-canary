import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

const MODES = new Set(['compare', 'run', 'pr-check', 'baseline-check', 'mcp-check', 'plugin-matrix', 'plugin-suite']);
const SUMMARY_LIMIT = 60_000;

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function parseBoolean(value, name) {
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}

export function parsePositiveInteger(value, name, { allowEmpty = true } = {}) {
  if ((value === undefined || value === '') && allowEmpty) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function parseVersions(value) {
  if (!value?.trim()) return [];
  const versions = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  for (const version of versions) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`versions must contain exact x.y.z releases; received ${JSON.stringify(version)}.`);
    }
  }
  return [...new Set(versions)];
}

function selectorArgs(config) {
  if (config.versions.length) return ['--versions', ...config.versions];
  if (config.from || config.to) {
    if (!config.from || !config.to) throw new Error('from and to must be provided together for plugin release ranges.');
    return ['--from', config.from, '--to', config.to];
  }
  return ['--last', String(config.last ?? 10)];
}

export function buildCliArgs(config) {
  switch (config.mode) {
    case 'compare': {
      if (!config.from) throw new Error('from is required when mode=compare.');
      return ['compare', config.scenario || '.canary/basic.canary.yml', '--from', config.from, '--to', config.to || 'latest'];
    }
    case 'run':
      return ['run', config.scenario || '.canary/basic.canary.yml'];
    case 'pr-check':
      return [
        'pr-check',
        config.scenario || '.canary/basic.canary.yml',
        '--base', config.baseRef || 'origin/main',
        '--head', config.headRef || 'HEAD',
      ];
    case 'baseline-check': {
      const args = ['baseline', 'check', config.scenario || '.canary/basic.canary.yml'];
      if (config.baseline) args.push('--baseline', config.baseline);
      return args;
    }
    case 'mcp-check': {
      const args = ['mcp-check', config.mcpContract || '.canary/mcp/server.mcp.yml'];
      if (config.baseline) args.push('--baseline', config.baseline);
      if (config.mcpRequireBaseline) args.push('--require-baseline');
      return args;
    }
    case 'plugin-matrix': {
      if (!config.plugin) throw new Error('plugin is required when mode=plugin-matrix.');
      const args = ['plugin-matrix', config.scenario || '.canary/plugin-smoke.canary.yml', '--plugin', config.plugin, ...selectorArgs(config)];
      if (config.platform) args.push('--platform', config.platform);
      if (!config.failOnIncompatible) args.push('--allow-incompatible');
      return args;
    }
    case 'plugin-suite': {
      if (!config.plugin) throw new Error('plugin is required when mode=plugin-suite.');
      const args = ['plugin-suite', '--plugin', config.plugin, ...selectorArgs(config)];
      if (config.suite) args.push('--suite', config.suite);
      if (config.platform) args.push('--platform', config.platform);
      if (config.maxRuns !== undefined) args.push('--max-runs', String(config.maxRuns));
      if (!config.failOnIncompatible) args.push('--allow-incompatible');
      return args;
    }
    default:
      throw new Error(`Unsupported mode: ${config.mode}`);
  }
}

function displayCommand(args) {
  const quote = (value) => /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
  return ['claude-canary', ...args].map(quote).join(' ');
}

export function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function snapshotResults(directory) {
  try {
    return new Set(await readdir(directory));
  } catch {
    return new Set();
  }
}

async function findNewestNewReport(directory, before) {
  let files;
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith('.md') && !before.has(name));
  } catch {
    return undefined;
  }
  if (!files.length) return undefined;
  const candidates = await Promise.all(files.map(async (name) => ({ name, mtime: (await stat(path.join(directory, name))).mtimeMs })));
  candidates.sort((a, b) => b.mtime - a.mtime);
  return path.join(directory, candidates[0].name);
}

function truncateForSummary(text) {
  if (text.length <= SUMMARY_LIMIT) return text;
  return `${text.slice(0, SUMMARY_LIMIT)}\n\n… output truncated in Step Summary; see the job log and uploaded artifacts for the complete result.`;
}

async function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  await appendFile(outputFile, `${name}=${String(value).replace(/[\r\n]+/g, ' ')}\n`, 'utf8');
}

async function appendSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  await appendFile(summaryFile, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
}

async function runCommand(executable, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let captured = '';
    const capture = (chunk, target) => {
      const text = chunk.toString();
      target.write(text);
      if (captured.length < SUMMARY_LIMIT) captured += text.slice(0, SUMMARY_LIMIT - captured.length);
    };
    child.stdout.on('data', (chunk) => capture(chunk, process.stdout));
    child.stderr.on('data', (chunk) => capture(chunk, process.stderr));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal, captured }));
  });
}

export function readConfig() {
  const mode = env('CANARY_MODE', 'compare');
  if (!MODES.has(mode)) throw new Error(`mode must be one of: ${[...MODES].join(', ')}.`);
  return {
    mode,
    scenario: env('CANARY_SCENARIO'),
    from: env('CANARY_FROM'),
    to: env('CANARY_TO'),
    baseRef: env('CANARY_BASE_REF'),
    headRef: env('CANARY_HEAD_REF'),
    baseline: env('CANARY_BASELINE'),
    mcpContract: env('CANARY_MCP_CONTRACT'),
    mcpRequireBaseline: parseBoolean(env('CANARY_MCP_REQUIRE_BASELINE', 'true'), 'mcp-require-baseline'),
    plugin: env('CANARY_PLUGIN'),
    suite: env('CANARY_SUITE'),
    versions: parseVersions(env('CANARY_VERSIONS')),
    last: parsePositiveInteger(env('CANARY_LAST'), 'last'),
    platform: env('CANARY_PLATFORM'),
    maxRuns: parsePositiveInteger(env('CANARY_MAX_RUNS'), 'max-runs'),
    failOnIncompatible: parseBoolean(env('CANARY_FAIL_ON_INCOMPATIBLE', 'true'), 'fail-on-incompatible'),
  };
}

export async function hydratePullRequestRefs(config, eventPath = process.env.GITHUB_EVENT_PATH) {
  if (config.mode !== 'pr-check' || (config.baseRef && config.headRef)) return config;
  let event = {};
  if (eventPath) {
    try { event = JSON.parse(await readFile(eventPath, 'utf8')); } catch { event = {}; }
  }
  return {
    ...config,
    baseRef: config.baseRef || event?.pull_request?.base?.sha || 'origin/main',
    headRef: config.headRef || event?.pull_request?.head?.sha || 'HEAD',
  };
}

async function main() {
  const config = await hydratePullRequestRefs(readConfig());
  const workspace = path.resolve(env('GITHUB_WORKSPACE', process.cwd()));
  const actionPath = path.resolve(env('GITHUB_ACTION_PATH', path.join(import.meta.dirname, '..')));
  const resultsDir = path.join(workspace, '.canary', 'results');
  await mkdir(resultsDir, { recursive: true });
  const before = await snapshotResults(resultsDir);
  const args = buildCliArgs(config);
  const command = displayCommand(args);
  const result = await runCommand(process.execPath, [path.join(actionPath, 'dist', 'index.js'), ...args], workspace);
  const reportPath = await findNewestNewReport(resultsDir, before);
  const passed = result.code === 0;
  const artifactName = `claude-canary-${config.mode}-${env('GITHUB_RUN_ID', 'local')}-${env('GITHUB_RUN_ATTEMPT', '1')}`;

  await writeOutput('results-path', resultsDir);
  await writeOutput('report-path', reportPath ?? '');
  await writeOutput('passed', passed ? 'true' : 'false');
  await writeOutput('exit-code', result.code);
  await writeOutput('artifact-name', artifactName);

  let body;
  if (reportPath) {
    body = truncateForSummary(await readFile(reportPath, 'utf8'));
  } else {
    body = `\`\`\`text\n${truncateForSummary(result.captured).trimEnd()}\n\`\`\``;
  }
  await appendSummary(
    `## Claude Canary\n\n` +
    `**Mode:** \`${config.mode}\`  \n` +
    `**Result:** ${passed ? '✅ Passed' : '❌ Failed'}  \n` +
    `**Command:** <code>${escapeHtmlText(command)}</code>\n\n` +
    `${body}\n`,
  );

  if (!passed) process.exitCode = result.code || 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('action-runner.mjs')) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`claude-canary action: ${message}`);
    await appendSummary(`## Claude Canary\n\n❌ Action configuration error: ${escapeHtmlText(message)}\n`);
    process.exitCode = 1;
  });
}
