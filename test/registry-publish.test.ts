import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  StaticRegistryIndexSchema,
  buildStaticRegistryIndex,
  publishCompatibilityRegistry,
  sha256Canonical,
  type CompatibilityRegistry,
} from '../src/api.js';

const sharedEvidence = 'a'.repeat(64);
const suiteA = 'b'.repeat(64);
const suiteB = 'c'.repeat(64);

function registry(): CompatibilityRegistry {
  return {
    schemaVersion: 1,
    name: 'example-registry',
    generatedAt: '2026-09-08T12:00:00.000Z',
    manifests: [
      {
        schemaVersion: 1,
        canaryVersion: '2.0.0',
        claudeCode: '2.1.263',
        component: 'plugin-alpha',
        componentVersion: '1.2.0',
        platform: 'linux-x64',
        suiteHash: suiteA,
        result: 'pass',
        createdAt: '2026-09-08T10:00:00.000Z',
        evidenceHash: sharedEvidence,
        failureFingerprints: [],
        metadata: { gitCommit: 'abc123' },
      },
      {
        schemaVersion: 1,
        canaryVersion: '2.0.0',
        claudeCode: '2.1.264',
        component: 'plugin-alpha',
        componentVersion: '1.2.0',
        platform: 'linux-x64',
        suiteHash: suiteB,
        result: 'fail',
        createdAt: '2026-09-08T11:00:00.000Z',
        evidenceHash: sharedEvidence,
        failureFingerprints: ['1'.repeat(16)],
        metadata: { gitCommit: 'def456' },
      },
      {
        schemaVersion: 1,
        canaryVersion: '2.0.0',
        claudeCode: '2.1.264',
        component: 'plugin-beta',
        platform: 'darwin-arm64',
        suiteHash: suiteA,
        result: 'unsupported',
        createdAt: '2026-09-08T11:30:00.000Z',
        evidenceHash: 'd'.repeat(64),
        failureFingerprints: [],
        metadata: {},
      },
    ],
  };
}

async function writeRegistry(root: string, value = registry()): Promise<string> {
  const file = path.join(root, 'registry.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

describe('static compatibility registry publishing', () => {
  it('builds a deterministic machine index with content-addressed manifests', () => {
    const value = registry();
    const index = buildStaticRegistryIndex(value, { baseUrl: 'https://example.test/compat/' });
    expect(() => StaticRegistryIndexSchema.parse(index)).not.toThrow();
    expect(index.baseUrl).toBe('https://example.test/compat');
    expect(index.manifestCount).toBe(3);
    expect(index.components).toHaveLength(2);
    expect(index.components[0].releases.map((release) => release.claudeCode)).toEqual(['2.1.264', '2.1.263']);

    const first = value.manifests[0];
    const second = value.manifests[1];
    expect(first.evidenceHash).toBe(second.evidenceHash);
    expect(index.components[0].releases[0].manifest).not.toBe(index.components[0].releases[1].manifest);
    expect(index.components[0].releases[1].manifestHash).toBe(sha256Canonical(first));
  });

  it('publishes a Pages/Release-ready bundle with stable checksums', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canary-registry-'));
    const registryFile = await writeRegistry(root);
    const outA = path.join(root, 'out-a');
    const outB = path.join(root, 'out-b');

    const a = await publishCompatibilityRegistry(registryFile, outA);
    const b = await publishCompatibilityRegistry(registryFile, outB);

    expect(a.manifestCount).toBe(3);
    expect(a.componentCount).toBe(2);
    expect(a.files).toContain('.claude-canary-registry');
    expect(a.files).toContain('registry.json');
    expect(a.files).toContain('index.json');
    expect(a.files).toContain('index.html');
    expect(a.files).toContain('.nojekyll');
    expect(a.files.filter((file) => file.startsWith('manifests/'))).toHaveLength(3);
    const checksums = await readFile(a.checksumPath, 'utf8');
    expect(checksums).toContain('  .claude-canary-registry');
    expect(checksums).toBe(await readFile(b.checksumPath, 'utf8'));
    expect(await readFile(a.indexPath, 'utf8')).toBe(await readFile(b.indexPath, 'utf8'));
    expect(await readFile(a.htmlPath!, 'utf8')).toContain('example-registry');
  });

  it('removes stale generated manifests when republishing a Canary-owned output directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canary-registry-refresh-'));
    const registryFile = await writeRegistry(root);
    const output = path.join(root, 'site');
    await publishCompatibilityRegistry(registryFile, output);
    await writeFile(path.join(output, 'manifests', 'stale.json'), '{}\n', 'utf8');

    await publishCompatibilityRegistry(registryFile, output);
    const manifests = await readdir(path.join(output, 'manifests'));
    expect(manifests).not.toContain('stale.json');
    expect(manifests).toHaveLength(3);
  });

  it('refuses to clean a non-empty directory it does not own', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canary-registry-safe-'));
    const registryFile = await writeRegistry(root);
    const output = path.join(root, 'site');
    await mkdir(output);
    await writeFile(path.join(output, 'keep.txt'), 'important\n', 'utf8');

    await expect(publishCompatibilityRegistry(registryFile, output)).rejects.toThrow(/not Canary-owned/i);
    expect(await readFile(path.join(output, 'keep.txt'), 'utf8')).toBe('important\n');
  });

  it('fails closed on unexpected top-level files even in a Canary-owned directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canary-registry-unexpected-'));
    const registryFile = await writeRegistry(root);
    const output = path.join(root, 'site');
    await publishCompatibilityRegistry(registryFile, output);
    await writeFile(path.join(output, 'secret.txt'), 'do not publish\n', 'utf8');

    await expect(publishCompatibilityRegistry(registryFile, output)).rejects.toThrow(/unexpected file/i);
    expect(await readFile(path.join(output, 'secret.txt'), 'utf8')).toBe('do not publish\n');
  });

  it('rejects unsafe or non-http public base URLs', () => {
    expect(() => buildStaticRegistryIndex(registry(), { baseUrl: 'file:///tmp/registry' })).toThrow(/http\(s\)/i);
    expect(() => buildStaticRegistryIndex(registry(), { baseUrl: 'https://user:pass@example.test/registry' })).toThrow(/without credentials/i);
    expect(() => buildStaticRegistryIndex(registry(), { baseUrl: 'https://example.test/registry?q=1' })).toThrow(/without credentials/i);
  });
});
