#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canFallbackAfter, configuredProviderOrder, isTerminalProviderCapacityFailure, terminalModelRequestStatus } from './provider-capacity.mjs';

const action = process.argv[2] ?? 'run';
const mode = process.argv[3] ?? 'core';
if (!['run', 'start-selected', 'stop', 'diagnose-selected'].includes(action)) {
  console.error('Usage: node scripts/live-provider-e2e.mjs <run|start-selected|stop|diagnose-selected> [core|full]');
  process.exit(2);
}
if (action === 'run' && !['core', 'full'].includes(mode)) {
  console.error('Usage: node scripts/live-provider-e2e.mjs run [core|full]');
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const liveDriver = path.join(repoRoot, 'scripts', 'live-e2e.mjs');
const routerCli = process.env.CLAUDE_CANARY_CCASR_CLI;
const providerRoot = path.resolve(process.env.CLAUDE_CANARY_PROVIDER_DIR ?? path.join(repoRoot, '.canary', 'provider-e2e'));
const fixtureRoot = path.resolve(process.env.CLAUDE_CANARY_E2E_DIR ?? path.join(providerRoot, 'live'));
const port = Number(process.env.CLAUDE_CANARY_PROVIDER_PORT ?? '3456');
const selectedPath = path.join(providerRoot, 'selected.json');
const pidPath = path.join(providerRoot, 'router.pid');
const geminiModel = process.env.CLAUDE_CANARY_GEMINI_MODEL ?? 'gemini-3.6-flash';
const groqModel = process.env.CLAUDE_CANARY_GROQ_MODEL ?? 'openai/gpt-oss-120b';
const openRouterModel = process.env.CLAUDE_CANARY_OPENROUTER_MODEL ?? 'openrouter/free';

if (!routerCli && action !== 'stop' && action !== 'diagnose-selected') {
  throw new Error('CLAUDE_CANARY_CCASR_CLI must point to the built ccasr dist/cli.js file.');
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('CLAUDE_CANARY_PROVIDER_PORT must be an integer between 1024 and 65535.');
}

const providers = {
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    model: geminiModel,
  },
  groq: {
    keyEnv: 'GROQ_API_KEY',
    model: groqModel,
  },
  openrouter: {
    keyEnv: 'OPENROUTER_API_KEY',
    model: openRouterModel,
  },
};

function configFor(providerName) {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unsupported provider: ${providerName}`);
  return {
    LOG: false,
    LOG_FILE: false,
    API_TIMEOUT_MS: 300000,
    PORT: port,
    Providers: {
      [providerName]: `$${provider.keyEnv}`,
    },
    Routes: {
      canary: {
        opus: `${providerName},${provider.model}`,
        sonnet: `${providerName},${provider.model}`,
        haiku: `${providerName},${provider.model}`,
      },
    },
    ActiveRoute: 'canary',
  };
}

async function waitForHealth(child) {
  const deadline = Date.now() + 15000;
  let lastError = 'router did not answer';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Router exited before becoming healthy (code ${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for provider router: ${lastError}`);
}

async function startRouter(providerName, { detached = false } = {}) {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unsupported provider: ${providerName}`);
  if (!process.env[provider.keyEnv]) throw new Error(`${provider.keyEnv} is not configured.`);
  await mkdir(providerRoot, { recursive: true });
  const configPath = path.join(providerRoot, `ccasr-${providerName}.json`);
  const logPath = path.join(providerRoot, `ccasr-${providerName}.log`);
  await writeFile(configPath, `${JSON.stringify(configFor(providerName), null, 2)}\n`, 'utf8');

  let stdout;
  let stderr;
  if (detached) {
    mkdirSync(path.dirname(logPath), { recursive: true });
    stdout = openSync(logPath, 'a');
    stderr = stdout;
  } else {
    stdout = 'pipe';
    stderr = 'pipe';
  }

  const child = spawn(process.execPath, [routerCli, 'start', '--config', configPath], {
    cwd: providerRoot,
    env: process.env,
    detached,
    stdio: ['ignore', stdout, stderr],
    windowsHide: true,
  });

  let captured = '';
  if (!detached) {
    // Keep bounded router diagnostics in memory: raw provider errors can contain account identifiers.
    const capture = (chunk) => { captured = (captured + chunk.toString()).slice(-256_000); };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
  } else {
    closeSync(stdout);
  }

  try {
    await waitForHealth(child);
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGTERM');
    throw error;
  }

  if (detached) child.unref();
  return { child, configPath, logPath, captured: () => captured };
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill('SIGTERM'); } catch { /* best effort */ }
}

function runCaptured(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({
        status: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      });
    });
  });
}

function appendGithubFile(target, values) {
  if (!target) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`).join('\n');
  writeFileSync(target, `${readFileSync(target, 'utf8')}${lines}\n`, 'utf8');
}

async function runSuite(providerName) {
  console.log(`\n=== Live provider: ${providerName} / ${providers[providerName].model} ===`);
  const router = await startRouter(providerName);
  try {
    const result = await runCaptured(process.execPath, [liveDriver, mode], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_API_KEY: 'ccasr-proxy',
        ANTHROPIC_AUTH_TOKEN: '',
        CLAUDE_CANARY_E2E_DIR: fixtureRoot,
        CLAUDE_CANARY_E2E_KEEP: '1',
      },
    });
    // Let the router pipe handlers flush a final provider error before deciding
    // whether a failure is eligible for a provider-capacity/availability fallback.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      ok: result.status === 0,
      status: result.status,
      providerStatus: terminalModelRequestStatus(router.captured()),
      capacityFailure: isTerminalProviderCapacityFailure(router.captured()),
    };
  } finally {
    stopChild(router.child);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function runWithFallback() {
  await mkdir(providerRoot, { recursive: true });
  const order = configuredProviderOrder({
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
  });
  if (order.length === 0) {
    throw new Error('Configure GEMINI_API_KEY, GROQ_API_KEY and/or OPENROUTER_API_KEY.');
  }

  const primaryProvider = order[0];
  const attempts = [];
  const attemptsPath = path.join(providerRoot, 'attempts.json');

  for (const [index, providerName] of order.entries()) {
    let result;
    try {
      result = await runSuite(providerName);
    } catch (error) {
      // Do not serialize exception text: upstream errors can contain credentials.
      attempts.push({ provider: providerName, status: null, outcome: 'router-error' });
      await writeFile(attemptsPath, `${JSON.stringify(attempts, null, 2)}\n`, 'utf8');
      throw error;
    }

    attempts.push({
      provider: providerName,
      status: result.providerStatus ?? null,
      outcome: result.ok ? 'passed' : result.capacityFailure ? 'capacity-failure' : 'test-failure',
    });
    // Safe, allowlisted status metadata allows diagnosing failed provider selection.
    await writeFile(attemptsPath, `${JSON.stringify(attempts, null, 2)}\n`, 'utf8');

    if (result.ok) {
      const selection = {
        primaryProvider,
        provider: providerName,
        model: providers[providerName].model,
        fallbackUsed: index > 0,
        selectedAt: new Date().toISOString(),
      };
      await writeFile(selectedPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
      appendGithubFile(process.env.GITHUB_OUTPUT, {
        'primary-provider': selection.primaryProvider,
        provider: selection.provider,
        model: selection.model,
        'fallback-used': selection.fallbackUsed,
      });
      console.log(`\nProvider-backed Live E2E passed via ${selection.provider} / ${selection.model}.`);
      return;
    }

    const hasNext = index + 1 < order.length;
    if (!canFallbackAfter(result, hasNext)) {
      if (result.capacityFailure) {
        throw new Error(`All ${order.length} configured providers exhausted or unavailable; the release gate remains closed.`);
      }
      throw new Error(`${providerName} live suite failed with exit code ${result.status}; not a provider capacity/availability failure. Release gate remains closed.`);
    }

    console.warn(`\n${providerName} returned a terminal provider capacity/availability error. Trying ${order[index + 1]} with a fresh fixture.`);
  }
}

async function startSelected() {
  const selected = JSON.parse(await readFile(selectedPath, 'utf8'));
  if (!providers[selected.provider]) throw new Error(`Invalid selected provider: ${selected.provider}`);
  try {
    const oldPid = Number((await readFile(pidPath, 'utf8')).trim());
    if (Number.isInteger(oldPid) && oldPid > 0) process.kill(oldPid, 'SIGTERM');
  } catch { /* no previous router */ }

  const router = await startRouter(selected.provider, { detached: true });
  await writeFile(pidPath, `${router.child.pid}\n`, 'utf8');
  appendGithubFile(process.env.GITHUB_ENV, {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_API_KEY: 'ccasr-proxy',
    ANTHROPIC_AUTH_TOKEN: '',
  });
  console.log(`Started ${selected.provider} router for the Action self-test (pid ${router.child.pid}).`);
}

async function diagnoseSelected() {
  // This step also runs after the *provider CLI* stage fails, before a
  // selected.json has ever been created. Never obscure the original failure.
  let selected;
  try { selected = JSON.parse(await readFile(selectedPath, 'utf8')); } catch { /* no selected provider */ }

  let description;
  if (selected && providers[selected.provider]) {
    const logPath = path.join(providerRoot, `ccasr-${selected.provider}.log`);
    let log = '';
    try { log = await readFile(logPath, 'utf8'); } catch { /* no router log */ }
    const status = terminalModelRequestStatus(log);
    description = status === 429
      ? 'Action self-test: selected provider exhausted its quota (HTTP 429).'
      : status === 503
        ? 'Action self-test: selected provider unavailable (HTTP 503).'
        : 'Action self-test: no terminal capacity error found; inspect the Canary result.';
  } else {
    let attempts = [];
    try {
      const parsed = JSON.parse(await readFile(path.join(providerRoot, 'attempts.json'), 'utf8'));
      if (Array.isArray(parsed)) attempts = parsed;
    } catch { /* provider selection may fail before its first attempt */ }
    const safe = attempts.filter((attempt) =>
      providers[attempt.provider] && ['passed', 'capacity-failure', 'test-failure', 'router-error'].includes(attempt.outcome)
    );
    description = safe.length > 0
      ? `Provider CLI stage: ${safe.map((attempt) => `${attempt.provider}: ${attempt.outcome}${Number.isInteger(attempt.status) ? ` (HTTP ${attempt.status})` : ''}`).join('; ')}.`
      : 'Provider CLI stage failed before any provider completed; inspect preceding workflow steps.';
  }
  console.log(`Live E2E diagnosis: ${description}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Live E2E failure diagnosis\n\n${description}\n`, { flag: 'a' });
  }
}

async function stopSelected() {
  try {
    const pid = Number((await readFile(pidPath, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    await rm(pidPath, { force: true });
  } catch { /* nothing to stop */ }
}

try {
  if (action === 'run') await runWithFallback();
  else if (action === 'start-selected') await startSelected();
  else if (action === 'diagnose-selected') await diagnoseSelected();
  else await stopSelected();
} catch (error) {
  console.error(`live-provider-e2e: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
