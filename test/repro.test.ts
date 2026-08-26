import { execFileSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  collectFixtureRoots,
  createReproBundle,
  fixtureRootFromPattern,
  isDeniedFixturePath,
} from '../src/repro.js';
import type { Scenario } from '../src/config.js';

const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('reproduction bundle safety', () => {
  it('keeps glob-derived fixture roots narrow', () => {
    expect(fixtureRootFromPattern('src/auth/*.ts')).toBe('src/auth');
    expect(fixtureRootFromPattern('src/auth/**')).toBe('src/auth');
    expect(fixtureRootFromPattern('src/auth/file.ts')).toBe('src/auth/file.ts');
    expect(fixtureRootFromPattern('*.ts')).toBeNull();
  });

  it('deny-lists credential and cache paths', () => {
    expect(isDeniedFixturePath('.env')).toBe(true);
    expect(isDeniedFixturePath('config/.env.production')).toBe(true);
    expect(isDeniedFixturePath('node_modules/pkg/index.js')).toBe(true);
    expect(isDeniedFixturePath('keys/server.pem')).toBe(true);
    expect(isDeniedFixturePath('../escape.txt')).toBe(true);
    expect(isDeniedFixturePath('src/auth/index.ts')).toBe(false);
  });

  it('adds only relevant build manifests for scenario commands', () => {
    const scenario = {
      version: 1,
      name: 'fixture-roots',
      prompt: 'Fix auth.',
      claude: { executable: 'claude', args: [], include_hook_events: false, timeout_seconds: 900, env: {} },
      verify: { commands: ['npm test'] },
      expect: {
        changed_files: { allow: ['src/auth/**'], require: ['src/auth/**'], deny: [] },
        files_exist: [],
        files_absent: [],
        file_contains: [],
      },
    } satisfies Scenario;

    const roots = collectFixtureRoots(scenario);
    expect(roots).toContain('src/auth');
    expect(roots).toContain('package.json');
    expect(roots).toContain('package-lock.json');
    expect(roots).not.toContain('src');
  });

  it('exports a minimal redacted bundle from the exact base commit and force-replaces only marked bundles', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'cc-canary-repro-test-'));
    temporaryRoots.push(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Canary Test');
    git(repo, 'config', 'user.email', 'canary@example.invalid');

    await mkdir(path.join(repo, 'src', 'auth'), { recursive: true });
    await writeFile(path.join(repo, 'src', 'auth', 'base.ts'), 'export const token = "sk-abcdefghijklmnopqrstuvwxyz123456";\n', 'utf8');
    await writeFile(path.join(repo, 'src', 'other.ts'), 'export const unrelated = true;\n', 'utf8');
    await writeFile(path.join(repo, '.env'), 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n', 'utf8');
    await writeFile(path.join(repo, 'package.json'), '{"scripts":{"test":"echo ok"}}\n', 'utf8');
    if (process.platform !== 'win32') {
      await symlink('../other.ts', path.join(repo, 'src', 'auth', 'link.ts'));
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'fixture baseline');
    const baseCommit = git(repo, 'rev-parse', 'HEAD');

    await mkdir(path.join(repo, '.canary', 'results'), { recursive: true });
    const scenario: Scenario = {
      version: 1,
      name: 'auth-repro',
      prompt: 'Fix the auth regression using C:\\Users\\alice\\private\\notes.txt',
      verify: { commands: ['npm test'] },
      claude: {
        executable: '/opt/claude/claude',
        args: [],
        include_hook_events: false,
        timeout_seconds: 900,
        env: { API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
      },
      expect: {
        changed_files: { allow: ['src/auth/*.ts'], require: ['src/auth/*.ts'], deny: [] },
        files_exist: ['src/auth/base.ts'],
        files_absent: ['src/auth/new.ts'],
        file_contains: [],
      },
      recording: {
        git_commit: baseCommit,
        recorded_at: '2026-08-27T00:00:00.000Z',
        claude_version: '2.1.237 (Claude Code)',
        executable: 'claude',
        config_files: ['CLAUDE.md', '.env'],
        prompt_redacted: false,
      },
    };
    const scenarioPath = path.join(repo, '.canary', 'auth-repro.canary.yml');
    await writeFile(scenarioPath, YAML.stringify(scenario), 'utf8');

    const resultPath = path.join(repo, '.canary', 'results', 'failed.json');
    await writeFile(resultPath, `${JSON.stringify({
      schemaVersion: 1,
      scenario: 'auth-repro',
      executable: 'C:\\Users\\alice\\bin\\claude.exe',
      passed: false,
      failures: ['Expected file missing at /home/alice/private/file.ts', 'token=sk-abcdefghijklmnopqrstuvwxyz123456'],
      claudeExitCode: 0,
      claudeTimedOut: false,
      durationMs: 1234,
      changedFiles: ['src/auth/base.ts'],
      setup: [],
      verification: [{ command: 'npm test', code: 1, durationMs: 10, timedOut: false }],
      metrics: {
        toolCalls: 4,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 30,
        hookEvents: [],
        parseErrors: 0,
      },
      createdAt: '2026-08-27T00:00:01.000Z',
      gitCommit: baseCommit,
      artifactPath: 'C:\\Users\\alice\\project\\.canary\\results\\failed.json',
    }, null, 2)}\n`, 'utf8');

    const output = path.join(repo, 'bundle');
    const bundle = await createReproBundle('.canary/results/failed.json', {
      cwd: repo,
      scenarioPath: '.canary/auth-repro.canary.yml',
      output,
    });

    expect(bundle.baseCommit).toBe(baseCommit);
    expect(bundle.exportedFiles).toContain('src/auth/base.ts');
    expect(bundle.exportedFiles).toContain('package.json');
    expect(bundle.exportedFiles).not.toContain('src/other.ts');
    expect(bundle.exportedFiles).not.toContain('.env');
    if (process.platform !== 'win32') expect(bundle.skippedFiles.some((item) => item.includes('src/auth/link.ts (symlink)'))).toBe(true);

    const exportedSource = await readFile(path.join(output, 'fixture', 'src', 'auth', 'base.ts'), 'utf8');
    expect(exportedSource).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(exportedSource).toContain('[REDACTED_SECRET]');
    expect(bundle.redactedFiles).toContain('src/auth/base.ts');

    expect(await fileExists(path.join(output, 'fixture', 'src', 'other.ts'))).toBe(false);
    expect(await fileExists(path.join(output, 'fixture', '.env'))).toBe(false);
    expect(await fileExists(path.join(output, 'reproduce.sh'))).toBe(true);
    expect(await fileExists(path.join(output, 'reproduce.ps1'))).toBe(true);
    expect(await fileExists(path.join(output, '.claude-canary-repro.json'))).toBe(true);

    const exportedScenario = await readFile(path.join(output, 'scenario.canary.yml'), 'utf8');
    expect(exportedScenario).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(exportedScenario).not.toContain('C:\\Users\\alice');
    expect(exportedScenario).not.toContain('.env');
    expect(exportedScenario).toContain('<ABSOLUTE_PATH>');

    const exportedResult = await readFile(path.join(output, 'result.json'), 'utf8');
    expect(exportedResult).not.toContain('artifactPath');
    expect(exportedResult).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(exportedResult).not.toContain('/home/alice');

    const environment = JSON.parse(await readFile(path.join(output, 'environment.json'), 'utf8')) as Record<string, unknown>;
    expect(environment).not.toHaveProperty('hostname');
    expect(environment).not.toHaveProperty('username');
    expect(JSON.stringify(environment)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');

    const issueReport = await readFile(path.join(output, 'issue-report.md'), 'utf8');
    expect(issueReport).toContain('Deterministic failures');
    expect(issueReport).toContain('./reproduce.sh');
    expect(issueReport).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(issueReport).not.toContain('/home/alice');

    await expect(createReproBundle('.canary/results/failed.json', {
      cwd: repo,
      scenarioPath: '.canary/auth-repro.canary.yml',
      output,
      force: true,
    })).resolves.toMatchObject({ outputPath: output, baseCommit });

    const unrelated = path.join(repo, 'do-not-delete');
    await mkdir(unrelated, { recursive: true });
    await writeFile(path.join(unrelated, 'keep.txt'), 'important\n', 'utf8');
    await expect(createReproBundle('.canary/results/failed.json', {
      cwd: repo,
      scenarioPath: '.canary/auth-repro.canary.yml',
      output: unrelated,
      force: true,
    })).rejects.toThrow(/not marked as a Claude Code Canary repro bundle/i);
    expect(await readFile(path.join(unrelated, 'keep.txt'), 'utf8')).toBe('important\n');
  });
});
