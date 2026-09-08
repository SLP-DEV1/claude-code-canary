import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildScenarioPackCatalog,
  buildScenarioPackDiscovery,
  ScenarioPackCatalogSchema,
} from '../src/pack-discovery.js';

async function packRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canary-pack-discovery-'));
  const scenario = 'version: 1\nname: smoke\nprompt: hello\n';
  await writeFile(path.join(root, 'smoke.canary.yml'), scenario, 'utf8');
  const sha = createHash('sha256').update(scenario).digest('hex');
  await writeFile(path.join(root, 'canary-pack.yml'), `schemaVersion: 1\nname: community-smoke\nversion: 1.2.3\ndescription: Community smoke scenarios\ncapabilities:\n  network: false\n  mutating: false\nfiles:\n  - path: smoke.canary.yml\n    sha256: ${sha}\n`, 'utf8');
  return root;
}

describe('scenario pack discovery metadata', () => {
  it('derives deterministic searchable metadata from a verified pack', async () => {
    const root = await packRoot();
    const first = await buildScenarioPackDiscovery(root, {
      tags: ['plugins', 'smoke', 'plugins'],
      authors: ['Example Maintainer'],
      license: 'MIT',
      repository: 'https://github.com/example/community-smoke',
      homepage: 'https://example.test/community-smoke',
    });
    const second = await buildScenarioPackDiscovery(root, {
      tags: ['smoke,plugins'],
      authors: ['Example Maintainer'],
      license: 'MIT',
      repository: 'https://github.com/example/community-smoke',
      homepage: 'https://example.test/community-smoke',
    });
    expect(first).toEqual(second);
    expect(first.tags).toEqual(['plugins', 'smoke']);
    expect(first.fileCount).toBe(1);
    expect(first.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.filesHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds a deduplicated deterministic community catalog', async () => {
    const root = await packRoot();
    const entry = await buildScenarioPackDiscovery(root, { tags: ['smoke'] });
    const catalog = buildScenarioPackCatalog([entry, structuredClone(entry)]);
    expect(() => ScenarioPackCatalogSchema.parse(catalog)).not.toThrow();
    expect(catalog.packs).toHaveLength(1);
  });

  it('rejects non-http discovery URLs', async () => {
    const root = await packRoot();
    await expect(buildScenarioPackDiscovery(root, { homepage: 'file:///tmp/pack' })).rejects.toThrow();
    expect(await readFile(path.join(root, 'canary-pack.yml'), 'utf8')).toContain('community-smoke');
  });
});
