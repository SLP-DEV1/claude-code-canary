import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnCapture } from './process.js';

async function git(args: string[], cwd: string): Promise<string> {
  const result = await spawnCapture('git', args, { cwd, timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function getRepoRoot(cwd: string): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

export async function getHeadCommit(cwd: string): Promise<string> {
  return git(['rev-parse', 'HEAD'], cwd);
}

export async function getTrackedChanges(cwd: string): Promise<string[]> {
  const output = await git(['status', '--porcelain', '--untracked-files=no'], cwd);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

export interface WorktreeHandle {
  path: string;
  cleanup: () => Promise<void>;
}

export async function createDetachedWorktree(repoRoot: string): Promise<WorktreeHandle> {
  const parent = await mkdtemp(path.join(tmpdir(), 'cc-canary-'));
  const worktreePath = path.join(parent, 'worktree');
  await git(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);

  return {
    path: worktreePath,
    cleanup: async () => {
      try {
        await git(['worktree', 'remove', '--force', worktreePath], repoRoot);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  };
}

export async function getChangedFiles(cwd: string): Promise<string[]> {
  const tracked = await git(['diff', '--name-only', 'HEAD'], cwd);
  const untracked = await git(['ls-files', '--others', '--exclude-standard'], cwd);
  return [...new Set([
    ...tracked.split(/\r?\n/),
    ...untracked.split(/\r?\n/),
  ].filter(Boolean))].sort();
}
