import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Scenario } from '../src/config.js';
import {
  assertPluginMatrixCompatibleScenario,
  assertPluginTreeSafe,
  formatPluginMatrixMarkdown,
  selectRecentPublishedVersions,
  validateExplicitVersions,
  type PluginMatrixResult,
} from '../src/plugin-matrix.js';

const temporaryRoots: string[] = [];

function scenario(args: string[] = []): Scenario {
  return {
    version: 1,
    name: 'plugin-smoke',
    prompt: 'Exercise the plugin command and leave the repository unchanged.',
    claude: {
      executable: 'claude',
      args,
      include_hook_events: false,
      timeout_seconds: 900,
      env: {},
    },
    expect: {
      changed_files: { allow: [], require: [], deny: [] },
      files_exist: [],
      files_absent: [],
      file_contains: [],
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('plugin compatibility matrix helpers', () => {
  it('selects the newest exact published releases in ascending order', () => {
    expect(selectRecentPublishedVersions([
      '2.1.9',
      'invalid',
      '2.1.11',
      '2.1.10',
      '2.1.11',
      '2.1.8',
    ], 3)).toEqual(['2.1.9', '2.1.10', '2.1.11']);
  });

  it('validates, de-duplicates and sorts explicit versions', () => {
    expect(validateExplicitVersions(['2.1.11', '2.1.9', '2.1.11'])).toEqual(['2.1.9', '2.1.11']);
    expect(() => validateExplicitVersions(['latest'])).toThrow(/exact x\.y\.z/i);
    expect(() => selectRecentPublishedVersions(['2.1.1'], 0)).toThrow(/--last/i);
  });

  it('rejects scenarios that already inject plugins', () => {
    expect(() => assertPluginMatrixCompatibleScenario(scenario(['--plugin-dir', './plugin']))).toThrow(/conflicts/i);
    expect(() => assertPluginMatrixCompatibleScenario(scenario(['--plugin-url=https://example.invalid/plugin']))).toThrow(/conflicts/i);
    expect(() => assertPluginMatrixCompatibleScenario(scenario())).not.toThrow();
  });

  it('rejects plugin trees containing symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cc-canary-plugin-tree-'));
    temporaryRoots.push(root);
    const plugin = path.join(root, 'plugin');
    await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"safe-plugin"}\n', 'utf8');
    await expect(assertPluginTreeSafe(plugin)).resolves.toBeUndefined();

    if (process.platform !== 'win32') {
      await writeFile(path.join(root, 'outside.txt'), 'outside\n', 'utf8');
      await symlink(path.join(root, 'outside.txt'), path.join(plugin, 'outside-link.txt'));
      await expect(assertPluginTreeSafe(plugin)).rejects.toThrow(/symbolic link/i);
    }
  });

  it('rejects non-directory plugin inputs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cc-canary-plugin-file-'));
    temporaryRoots.push(root);
    const file = path.join(root, 'plugin.zip');
    await writeFile(file, 'not a directory', 'utf8');
    await expect(assertPluginTreeSafe(file)).rejects.toThrow(/must be a directory/i);
  });

  it('formats a README-friendly markdown matrix', () => {
    const result: PluginMatrixResult = {
      schemaVersion: 1,
      kind: 'plugin-compatibility-matrix',
      canaryVersion: '0.1.0',
      scenario: 'plugin-smoke',
      pluginName: 'example-plugin',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      versions: ['2.1.9', '2.1.10'],
      entries: [
        { version: '2.1.9', passed: true, failures: [], durationMs: 100, toolCalls: 2, totalTokens: 100 },
        { version: '2.1.10', passed: false, failures: ['Plugin command missing | incompatible'], durationMs: 120, toolCalls: 1, totalTokens: 80 },
      ],
      compatible: 1,
      incompatible: 1,
      firstIncompatibleVersion: '2.1.10',
      createdAt: '2026-08-27T00:00:00.000Z',
    };

    const markdown = formatPluginMatrixMarkdown(result);
    expect(markdown).toContain('example-plugin');
    expect(markdown).toContain('`2.1.9` | ✅ Compatible');
    expect(markdown).toContain('`2.1.10` | ❌ Incompatible');
    expect(markdown).toContain('First incompatible release');
    expect(markdown).toContain('missing \\| incompatible');
  });
});
