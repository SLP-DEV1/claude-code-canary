import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diagnoseCompatibilityArtifact,
  diagnoseCompatibilityFile,
  formatCompatibilityDiagnostics,
} from '../src/compatibility-diagnostics.js';
import { sha256Canonical, type CanaryLock, type CompatibilityManifest, type CompatibilityRegistry } from '../src/compatibility.js';

const hash = (char: string): string => char.repeat(64);

function manifest(overrides: Partial<CompatibilityManifest> = {}): CompatibilityManifest {
  return {
    schemaVersion: 1,
    canaryVersion: '2.0.0',
    claudeCode: '2.1.263',
    component: 'demo-plugin',
    componentVersion: '1.0.0',
    platform: 'linux-x64',
    suiteHash: hash('a'),
    result: 'pass',
    createdAt: '2026-09-07T20:00:00.000Z',
    evidenceHash: hash('b'),
    failureFingerprints: [],
    metadata: {},
    ...overrides,
  };
}

describe('compatibility evidence diagnostics', () => {
  it('accepts a current manifest whose supplied evidence and suite definition match', () => {
    const evidence = { suite: 'release', passed: true, scenarios: 4 };
    const suiteDefinition = { suite: 'release', suitePath: '.canary/release.suite.yml' };
    const value = manifest({
      evidenceHash: sha256Canonical(evidence),
      suiteHash: sha256Canonical(suiteDefinition),
    });

    const result = diagnoseCompatibilityArtifact(value, {
      now: new Date('2026-09-07T21:00:00.000Z'),
      maxAgeDays: 1,
      expectedClaudeCode: '2.1.263',
      expectedPlatform: 'linux-x64',
      expectedComponent: 'demo-plugin',
      expectedComponentVersion: '1.0.0',
      evidence,
      suiteDefinition,
    });

    expect(result.kind).toBe('manifest');
    expect(result.valid).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('returns field-level schema diagnostics instead of throwing on malformed evidence', () => {
    const result = diagnoseCompatibilityArtifact({
      ...manifest(),
      claudeCode: 'latest',
      evidenceHash: 'broken',
      unexpected: true,
    });

    expect(result.kind).toBe('manifest');
    expect(result.valid).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.filter((item) => item.code === 'schema-invalid').map((item) => item.path)).toEqual(expect.arrayContaining([
      'claudeCode',
      'evidenceHash',
      '<root>',
    ]));
    expect(formatCompatibilityDiagnostics(result)).toContain('Status: INVALID');
    expect(formatCompatibilityDiagnostics(result)).toContain('Fix:');
  });

  it('pinpoints stale hashes, target drift and age in one pass', () => {
    const result = diagnoseCompatibilityArtifact(manifest({ createdAt: '2026-08-01T00:00:00.000Z' }), {
      now: new Date('2026-09-07T21:00:00.000Z'),
      maxAgeDays: 30,
      expectedClaudeCode: '2.1.264',
      expectedPlatform: 'win32-x64',
      evidence: { current: true },
      suiteDefinition: { changed: true },
    });

    expect(result.valid).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'age-exceeded',
      'release-mismatch',
      'platform-mismatch',
      'evidence-hash-mismatch',
      'suite-hash-mismatch',
    ]));
  });

  it('detects registry timestamps that predate embedded evidence and conflicting target evidence', () => {
    const registry: CompatibilityRegistry = {
      schemaVersion: 1,
      name: 'workspace',
      generatedAt: '2026-09-07T19:00:00.000Z',
      manifests: [
        manifest({ createdAt: '2026-09-07T20:00:00.000Z' }),
        manifest({ createdAt: '2026-09-07T20:01:00.000Z', evidenceHash: hash('c'), result: 'fail' }),
      ],
    };

    const result = diagnoseCompatibilityArtifact(registry, { now: new Date('2026-09-07T21:00:00.000Z') });
    expect(result.valid).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'registry-older-than-evidence',
      'registry-conflicting-evidence',
    ]));
  });

  it('turns canary.lock drift against current manifests into actionable diagnostics', () => {
    const lock: CanaryLock = {
      schemaVersion: 1,
      canaryVersion: '2.0.0',
      claudeCode: '2.1.263',
      platform: 'linux-x64',
      suites: [{ component: 'demo-plugin', componentVersion: '1.0.0', suiteHash: hash('a'), evidenceHash: hash('b') }],
      generatedAt: '2026-09-07T20:00:00.000Z',
    };
    const current = manifest({ suiteHash: hash('c'), evidenceHash: hash('d') });

    const result = diagnoseCompatibilityArtifact(lock, { manifests: [current] });
    expect(result.valid).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'lock-suite-drift',
      'lock-evidence-drift',
    ]));
    expect(result.diagnostics.find((item) => item.code === 'lock-suite-drift')?.fix).toContain('lock diff');
  });

  it('reports semantic timestamp corruption even though the v1 schema stores timestamps as strings', () => {
    const result = diagnoseCompatibilityArtifact(manifest({ createdAt: 'not-a-date' }));
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'timestamp-invalid')).toBe(true);
  });

  it('reports invalid JSON as a diagnostic result instead of throwing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'canary-evidence-diagnostic-'));
    const file = path.join(dir, 'broken.compat.json');
    await writeFile(file, '{ nope', 'utf8');

    const result = await diagnoseCompatibilityFile(file);
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('unknown');
    expect(result.diagnostics[0].code).toBe('json-invalid');
  });
});
