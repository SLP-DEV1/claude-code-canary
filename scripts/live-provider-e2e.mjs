#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const action = process.argv[2] ?? 'run';
const mode = process.argv[3] ?? 'core';
if (!['run', 'start-selected', 'stop'].includes(action)) {
  console.error('Usage: node scripts/live-provider-e2e.mjs <run|start-selected|stop> [core|full]');
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
const groqModel = process.env.CLAUDE_CANARY_GROQ_MODEL ?? 'openai/gpt-oss-120b';
const openRouterModel = process.env.CLAUDE_CANARY_OPENROUTER_MODEL ?? 'openrouter/free';

if (!routerCli && action !== 'stop') {
  throw new Error('CLAUDE_CANARY_CCASR_CLI must point to the built ccasr dist/cli.js file.');
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('CLAUDE_CANARY_PROVIDER_PORT must be an integer between 1024 and 65535.');
}

const providers = {
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
    child.stdout?.on('data', (chunk) => { captured += chunk.toString(); process.stdout.write(chunk); });
    child.stderr?.on('data', (chunk) => { captured += chunk.toString(); process.stderr.write(chunk); });
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

function isGroqRateLimit(text) {
  return [
    /\b429\b/i,
    /too many requests/i,
    /rate[ _-]?limit/i,
    /rate_limit_exceeded/i,
    /quota/i,
    /requests per (?:day|minute)/i,
    /tokens per (?:day|minute)/i,
    /\b(?:RPD|RPM|TPD|TPM)\b/i,
  ].some((pattern) => pattern.test(text));
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
    // Let the router's pipe handlers flush any final provider error before
    // deciding whether a failed Groq run is eligible for the fallback.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      ok: result.status === 0,
      status: result.status,
      diagnostic: `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${router.captured()}`,
    };
  } finally {
    stopChild(router.child);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function runWithFallback() {
  await mkdir(providerRoot, { recursive: true });
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
  if (!hasGroq && !hasOpenRouter) {
    throw new Error('Configure GROQ_API_KEY and/or OPENROUTER_API_KEY.');
  }

  let selected;
  let fallbackUsed = false;
  if (hasGroq) {
    const primary = await runSuite('groq');
    if (primary.ok) {
      selected = 'groq';
    } else if (hasOpenRouter && isGroqRateLimit(primary.diagnostic)) {
      fallbackUsed = true;
      console.warn('\nGroq hit a rate/quota limit. Retrying the complete live suite through OpenRouter.');
      const fallback = await runSuite('openrouter');
      if (!fallback.ok) throw new Error(`OpenRouter fallback failed with exit code ${fallback.status}.`);
      selected = 'openrouter';
    } else {
      throw new Error(`Groq live suite failed with exit code ${primary.status}; not falling back because this does not look like a rate/quota limit.`);
    }
  } else {
    const fallback = await runSuite('openrouter');
    if (!fallback.ok) throw new Error(`OpenRouter live suite failed with exit code ${fallback.status}.`);
    selected = 'openrouter';
  }

  const selection = {
    provider: selected,
    model: providers[selected].model,
    fallbackUsed,
    selectedAt: new Date().toISOString(),
  };
  await writeFile(selectedPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
  appendGithubFile(process.env.GITHUB_OUTPUT, {
    provider: selection.provider,
    model: selection.model,
    'fallback-used': selection.fallbackUsed,
  });
  console.log(`\nProvider-backed Live E2E passed via ${selection.provider} / ${selection.model}.`);
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
  else await stopSelected();
} catch (error) {
  console.error(`live-provider-e2e: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
