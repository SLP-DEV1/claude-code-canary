import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverExtendedPluginSurfaces } from '../src/plugin-surfaces.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-plugin-surfaces-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('extended plugin surfaces', () => {
  it('discovers LSP servers, monitors and plugin dependencies deterministically', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'monitors'), { recursive: true });
    await writeFile(path.join(root, '.lsp.json'), JSON.stringify({
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.tsx': 'typescriptreact', '.ts': 'typescript' },
        diagnostics: true,
      },
    }), 'utf8');
    await writeFile(path.join(root, 'monitors', 'monitors.json'), JSON.stringify([
      { name: 'errors', command: 'tail -F logs/error.log', description: 'Watch application errors' },
    ]), 'utf8');

    const surfaces = await discoverExtendedPluginSurfaces(root, {
      dependencies: [
        'audit-logger',
        { name: 'secrets-vault', version: '~2.1.0', marketplace: 'shared-tools' },
      ],
    });

    expect(surfaces.lspServers).toEqual([expect.objectContaining({
      name: 'typescript',
      command: 'typescript-language-server',
      extensions: ['.ts', '.tsx'],
      path: '.lsp.json',
      source: 'default',
    })]);
    expect(surfaces.monitors).toEqual([expect.objectContaining({ name: 'errors', source: 'default' })]);
    expect(surfaces.dependencies).toEqual([
      { name: 'audit-logger' },
      { name: 'secrets-vault', version: '~2.1.0', marketplace: 'shared-tools' },
    ]);
  });

  it('supports manifest LSP paths and inline experimental monitors', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'config'), { recursive: true });
    await writeFile(path.join(root, 'config', 'lsp.json'), JSON.stringify({
      go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
    }), 'utf8');

    const surfaces = await discoverExtendedPluginSurfaces(root, {
      lspServers: './config/lsp.json',
      experimental: {
        monitors: [
          { name: 'deploy', command: './poll.sh', description: 'Deployment state', when: 'on-skill-invoke:deploy' },
        ],
      },
    });

    expect(surfaces.lspServers[0]).toMatchObject({ name: 'go', path: 'config/lsp.json', source: 'manifest' });
    expect(surfaces.monitors[0]).toMatchObject({ name: 'deploy', when: 'on-skill-invoke:deploy', source: 'manifest' });
  });

  it('rejects malformed executable surfaces without running them', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, '.lsp.json'), JSON.stringify({ broken: { command: '', extensionToLanguage: { '.x': 'x' } } }), 'utf8');
    await expect(discoverExtendedPluginSurfaces(root, {})).rejects.toThrow(/non-empty command/i);

    await rm(path.join(root, '.lsp.json'));
    await expect(discoverExtendedPluginSurfaces(root, {
      experimental: { monitors: [{ name: 'watch', command: './watch.sh' }] },
    })).rejects.toThrow(/missing description/i);
  });

  it('tracks legacy monitor declarations with a migration warning', async () => {
    const root = await tempRoot();
    const surfaces = await discoverExtendedPluginSurfaces(root, {
      monitors: [{ name: 'legacy', command: './watch.sh', description: 'Legacy monitor' }],
    });
    expect(surfaces.monitors).toHaveLength(1);
    expect(surfaces.warnings.join(' ')).toMatch(/deprecated.*experimental\.monitors/i);
  });

  it('rejects unsafe paths and conflicting dependency declarations', async () => {
    const root = await tempRoot();
    await expect(discoverExtendedPluginSurfaces(root, { lspServers: '../outside.json' })).rejects.toThrow(/must start with \.\//i);
    await expect(discoverExtendedPluginSurfaces(root, {
      dependencies: [
        { name: 'shared', version: '^1' },
        { name: 'shared', version: '^2' },
      ],
    })).rejects.toThrow(/conflicting duplicate plugin dependency/i);
  });
});
