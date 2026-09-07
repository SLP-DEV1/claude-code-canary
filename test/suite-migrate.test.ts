import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateSuiteDefinition, migrateSuiteFile } from '../src/suite-migrate.js';
import { loadSuite } from '../src/suite.js';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-suite-migrate-'));
  await mkdir(path.join(root, '.canary'), { recursive: true });
  return root;
}

describe('suite migrate', () => {
  it('migrates legacy aliases and scenario entry shapes', () => {
    const result = migrateSuiteDefinition({
      version: 0,
      suite: 'legacy-release',
      files: ['.canary/**/*.canary.yml'],
      ignore: '.canary/skip.canary.yml',
      workers: '3',
      failFast: true,
      maxRuns: 25,
      reuseResults: 'true',
      scenarios: [
        '.canary/smoke.canary.yml',
        { file: '.canary/release.canary.yml', tags: ['release'], alwaysRun: true },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.legacyDetected).toBe(true);
    expect(result.suite).toMatchObject({
      version: 1,
      name: 'legacy-release',
      include: ['.canary/**/*.canary.yml'],
      exclude: ['.canary/skip.canary.yml'],
      concurrency: 3,
      fail_fast: true,
      max_runs: 25,
      reuse_results: true,
    });
    expect(result.suite.scenarios[0].path).toBe('.canary/smoke.canary.yml');
    expect(result.suite.scenarios[1]).toMatchObject({
      path: '.canary/release.canary.yml',
      tags: ['release'],
      always: true,
    });
    expect(result.changes).toContain('Renamed files -> include');
    expect(result.changes).toContain('Renamed failFast -> fail_fast');
  });

  it('migrates a top-level scenario list using the fallback name', () => {
    const result = migrateSuiteDefinition(
      ['.canary/a.canary.yml', { scenario: '.canary/b.canary.yml' }],
      'legacy-list',
    );
    expect(result.suite.name).toBe('legacy-list');
    expect(result.suite.scenarios.map((item) => item.path)).toEqual([
      '.canary/a.canary.yml',
      '.canary/b.canary.yml',
    ]);
  });

  it('writes side-by-side by default and produces a loadable suite', async () => {
    const root = await workspace();
    try {
      const source = path.join(root, '.canary', 'legacy.suite.yml');
      await writeFile(source, 'suite: legacy\nincludes: .canary/**/*.canary.yml\nparallel: 2\n', 'utf8');

      const result = await migrateSuiteFile({ cwd: root, source: '.canary/legacy.suite.yml' });
      expect(result.output).toBe('.canary/legacy.migrated.suite.yml');
      expect(result.written).toBe(true);
      const suite = await loadSuite(path.join(root, result.output));
      expect(suite.name).toBe('legacy');
      expect(suite.concurrency).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates a backup for in-place migration and preserves the original bytes', async () => {
    const root = await workspace();
    try {
      const source = path.join(root, '.canary', 'legacy.yml');
      const original = 'suite: backup-test\nfiles: .canary/*.canary.yml\nfailFast: true\n';
      await writeFile(source, original, 'utf8');

      const result = await migrateSuiteFile({ cwd: root, source: '.canary/legacy.yml', inPlace: true });
      expect(result.output).toBe('.canary/legacy.yml');
      expect(result.backup).toBe('.canary/legacy.yml.bak');
      expect(await readFile(path.join(root, result.backup!), 'utf8')).toBe(original);
      expect((await loadSuite(source)).fail_fast).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on unknown legacy fields', () => {
    expect(() => migrateSuiteDefinition({
      suite: 'unsafe',
      files: ['.canary/*.canary.yml'],
      mystery_mode: true,
    })).toThrow('unsupported field(s): mystery_mode');
  });

  it('supports dry-run without creating migrated output', async () => {
    const root = await workspace();
    try {
      await writeFile(
        path.join(root, '.canary', 'legacy.yaml'),
        '- .canary/a.canary.yml\n- .canary/b.canary.yml\n',
        'utf8',
      );
      const result = await migrateSuiteFile({ cwd: root, source: '.canary/legacy.yaml', dryRun: true });
      expect(result.written).toBe(false);
      expect(result.yaml).toContain('version: 1');
      expect(await exists(path.join(root, '.canary', 'legacy.migrated.yaml'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not rewrite or back up an already-current suite in place', async () => {
    const root = await workspace();
    try {
      const source = path.join(root, '.canary', 'current.suite.yml');
      const current = 'version: 1\nname: current\ninclude:\n  - .canary/**/*.canary.yml\n';
      await writeFile(source, current, 'utf8');

      const result = await migrateSuiteFile({ cwd: root, source: '.canary/current.suite.yml', inPlace: true });
      expect(result.changed).toBe(false);
      expect(result.written).toBe(false);
      expect(result.backup).toBeUndefined();
      expect(await readFile(source, 'utf8')).toBe(current);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
