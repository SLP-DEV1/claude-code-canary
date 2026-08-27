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

async function ensureExactSha(sha, cwd) {
  if (!SHA.test(sha)) return;
  const exists = await runGit(['cat-file', '-e', `${sha}^{commit}`], cwd);
  if (exists.code === 0) return;
  const fetched = await runGit(['fetch', '--no-tags', '--depth=1', 'origin', sha], cwd);
  if (fetched.code !== 0) throw new Error(`git fetch failed for PR commit ${sha.slice(0, 12)}: ${fetched.stderr.trim()}`);
  const verified = await runGit(['cat-file', '-e', `${sha}^{commit}`], cwd);
  if (verified.code !== 0) throw new Error(`Fetched PR commit ${sha.slice(0, 12)} is still unavailable.`);
}

async function main() {
  if (process.env.CANARY_MODE !== 'pr-check') return;
  let event = {};
  if (process.env.GITHUB_EVENT_PATH) {
    try { event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { event = {}; }
  }
  const refs = exactPullRequestRefs(event, process.env.CANARY_BASE_REF || '', process.env.CANARY_HEAD_REF || '');
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  await ensureExactSha(refs.base, cwd);
  if (refs.head !== refs.base) await ensureExactSha(refs.head, cwd);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ensure-pr-refs.mjs')) {
  main().catch((error) => {
    console.error(`claude-canary PR refs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
