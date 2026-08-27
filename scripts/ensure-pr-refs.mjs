import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';

const SHA = /^[0-9a-f]{40}$/i;

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export function exactPullRequestRefs(event, explicitBase = '', explicitHead = '') {
  return {
    base: explicitBase || event?.pull_request?.base?.sha || '',
    head: explicitHead || event?.pull_request?.head?.sha || '',
  };
}

export function pullRequestFetchFallbacks(event, explicitBase = '', explicitHead = '') {
  const pr = event?.pull_request;
  const number = Number(pr?.number ?? event?.number);
  const baseRef = typeof pr?.base?.ref === 'string' && pr.base.ref ? `refs/heads/${pr.base.ref}` : undefined;
  const pullHead = Number.isInteger(number) && number > 0 ? `refs/pull/${number}/head` : undefined;
  return {
    base: explicitBase ? undefined : baseRef,
    head: explicitHead ? undefined : pullHead,
  };
}

async function hasCommit(sha, cwd) {
  const exists = await runGit(['cat-file', '-e', `${sha}^{commit}`], cwd);
  return exists.code === 0;
}

async function ensureExactSha(sha, cwd, fallbackRef) {
  if (!SHA.test(sha) || await hasCommit(sha, cwd)) return;

  const direct = await runGit(['fetch', '--no-tags', '--depth=1', 'origin', sha], cwd);
  if (direct.code === 0 && await hasCommit(sha, cwd)) return;

  if (fallbackRef) {
    const fallback = await runGit(['fetch', '--no-tags', '--depth=1', 'origin', fallbackRef], cwd);
    if (fallback.code === 0 && await hasCommit(sha, cwd)) return;
    const detail = fallback.stderr.trim() || direct.stderr.trim();
    throw new Error(`git fetch failed to hydrate PR commit ${sha.slice(0, 12)} via ${fallbackRef}: ${detail}`);
  }

  throw new Error(`git fetch failed for PR commit ${sha.slice(0, 12)}: ${direct.stderr.trim()}`);
}

async function main() {
  if (process.env.CANARY_MODE !== 'pr-check') return;
  let event = {};
  if (process.env.GITHUB_EVENT_PATH) {
    try { event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { event = {}; }
  }
  const explicitBase = process.env.CANARY_BASE_REF || '';
  const explicitHead = process.env.CANARY_HEAD_REF || '';
  const refs = exactPullRequestRefs(event, explicitBase, explicitHead);
  const fallbacks = pullRequestFetchFallbacks(event, explicitBase, explicitHead);
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  await ensureExactSha(refs.base, cwd, fallbacks.base);
  if (refs.head !== refs.base) await ensureExactSha(refs.head, cwd, fallbacks.head);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ensure-pr-refs.mjs')) {
  main().catch((error) => {
    console.error(`claude-canary PR refs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
