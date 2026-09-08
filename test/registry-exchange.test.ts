import { describe, expect, it } from 'vitest';
import {
  exportCompatibilityRegistry,
  importCompatibilityRegistries,
} from '../src/registry-exchange.js';
import { mergeCompatibilityRegistries, type CompatibilityManifest, type CompatibilityRegistry } from '../src/compatibility.js';

function manifest(overrides: Partial<CompatibilityManifest> = {}): CompatibilityManifest {
  return {
    schemaVersion: 1,
    canaryVersion: '2.0.0',
    claudeCode: '2.1.264',
    component: 'plugin-alpha',
    componentVersion: '1.0.0',
    platform: 'linux-x64',
    suiteHash: 'a'.repeat(64),
    result: 'pass',
    createdAt: '2026-09-08T12:00:00.000Z',
    evidenceHash: 'b'.repeat(64),
    failureFingerprints: [],
    metadata: {},
    ...overrides,
  };
}

function registry(name: string, manifests: CompatibilityManifest[], generatedAt = '2026-09-08T12:00:00.000Z'): CompatibilityRegistry {
  return { schemaVersion: 1, name, generatedAt, manifests };
}

describe('independent registry exchange', () => {
  it('exports a deterministic filtered subset without inventing freshness', () => {
    const source = registry('source', [
      manifest(),
      manifest({ component: 'plugin-beta', platform: 'darwin-arm64', evidenceHash: 'c'.repeat(64) }),
    ]);
    const exported = exportCompatibilityRegistry(source, { component: 'plugin-alpha' }, { name: 'alpha-only' });
    expect(exported.name).toBe('alpha-only');
    expect(exported.generatedAt).toBe(source.generatedAt);
    expect(exported.manifests).toHaveLength(1);
    expect(exported.manifests[0].component).toBe('plugin-alpha');
  });

  it('preserves distinct manifests that reference the same evidence hash', () => {
    const a = manifest({ metadata: { source: 'one' } });
    const b = manifest({ claudeCode: '2.1.265', metadata: { source: 'two' } });
    expect(a.evidenceHash).toBe(b.evidenceHash);
    const imported = importCompatibilityRegistries(registry('base', [a]), [registry('incoming', [b])]);
    expect(imported.registry.manifests).toHaveLength(2);
    expect(imported.added).toBe(1);

    const merged = mergeCompatibilityRegistries('merged', [registry('a', [a]), registry('b', [b])]);
    expect(merged.manifests).toHaveLength(2);
  });

  it('deduplicates byte-equivalent manifests across registries', () => {
    const a = manifest();
    const imported = importCompatibilityRegistries(registry('base', [a]), [registry('incoming', [structuredClone(a)])]);
    expect(imported.registry.manifests).toHaveLength(1);
    expect(imported.duplicates).toBe(1);
  });

  it('fails closed on contradictory target results unless explicitly allowed', () => {
    const good = manifest({ result: 'pass', evidenceHash: 'b'.repeat(64) });
    const bad = manifest({ result: 'fail', evidenceHash: 'c'.repeat(64), createdAt: '2026-09-08T13:00:00.000Z' });
    expect(() => importCompatibilityRegistries(registry('base', [good]), [registry('incoming', [bad])])).toThrow(/contradictory result/i);
    const allowed = importCompatibilityRegistries(registry('base', [good]), [registry('incoming', [bad])], { allowResultConflicts: true });
    expect(allowed.conflicts).toHaveLength(1);
    expect(allowed.conflicts[0].kind).toBe('result');
    expect(allowed.registry.manifests).toHaveLength(2);
  });
});
