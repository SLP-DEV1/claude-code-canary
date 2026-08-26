import { getRepoRoot, getTrackedChanges } from './git.js';
import { spawnCapture } from './process.js';
import type { DoctorCheck } from './types.js';

export async function runDoctor(cwd: string, claudeExecutable = 'claude'): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'Node.js', ok: nodeMajor >= 20, detail: process.version });

  const git = await spawnCapture('git', ['--version'], { cwd, timeoutMs: 10_000 });
  checks.push({ name: 'Git', ok: git.code === 0, detail: git.code === 0 ? git.stdout.trim() : 'not available' });

  const claude = await spawnCapture(claudeExecutable, ['--version'], { cwd, timeoutMs: 15_000 });
  checks.push({ name: 'Claude Code', ok: claude.code === 0, detail: claude.code === 0 ? (claude.stdout || claude.stderr).trim() : `${claudeExecutable} not available` });

  try {
    const repo = await getRepoRoot(cwd);
    checks.push({ name: 'Git repository', ok: true, detail: repo });
    const changes = await getTrackedChanges(repo);
    checks.push({
      name: 'Tracked tree clean',
      ok: changes.length === 0,
      detail: changes.length === 0 ? 'clean' : `${changes.length} tracked change(s); commit or stash before running`,
    });
  } catch (error) {
    checks.push({ name: 'Git repository', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  return checks;
}

export function formatDoctor(checks: DoctorCheck[]): string {
  const lines = ['Claude Code Canary — doctor', ''];
  for (const check of checks) lines.push(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  return lines.join('\n');
}
