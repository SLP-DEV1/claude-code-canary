import { describe, expect, it } from 'vitest';
import {
  diffCanaryLocks,
  diffCompatibilityManifests,
  formatCompatibilityDiff,
} from '../src/compatibility-diff.js';
import type { CanaryLock, CompatibilityManifest } from '../src/compatibility.js';

const hash = (char: string): string => char.repeat(64);
const fingerprint = (char: string): string => char.repeat(16);

function manifest(overrides: Partial<CompatibilityManifest> = {}): CompatibilityManifest {
  return {
    schemaVersion: 1,
    canaryVersion: '2.0.0',
    claudeCode: '2.1.262',
    component: 'demo-plugin',
    componentVersion: '1.0.0',
    platform: 'linux-x64',
    suiteHash: hash('a'),
    result: 'pass',
    createdAt: '2026-09-07T18:00:00.000Z',
    evidenceHash: hash('b'),
    failureFingerprints: [],
    metadata: { gitCommit: 'abc123' },
    ...overrides,
  };
}

function lock(overrides: Partial<CanaryLock> = {}): CanaryLock {
  return {
    schemaVersion: 1,
    canaryVersion: '2.0.0',
    claudeCode: '2.1.262',
    platform: 'linux-x64',
    suites: [
      {
        component: 'demo-plugin',
        componentVersion: '1.0.0',
        suiteHash: hash('a'),
        evidenceHash: hash('b'),
      },
    ],
    generatedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

describe('compatibility diff explanations', () => {
  it('treats timestamps as volatile and ignores timestamp-only changes', () => {
    const manifestDiff = diffCompatibilityManifests(
      manifest(),
      manifest({ createdAt: '2026-09-07T19:00:00.000Z' }),
    );
    expect(manifestDiff.changed).toBe(false);
    expect(manifestDiff.impact).toBe('none');
    expect(manifestDiff.ignoredFields).toEqual(['createdAt']);

    const lockDiff = diffCanaryLocks(
      lock(),
      lock({ generatedAt: '2026-09-07T19:00:00.000Z' }),
    );
    expect(lockDiff.changed).toBe(false);
    expect(lockDiff.ignoredFields).toEqual(['generatedAt']);
  });

  it('classifies pass-to-fail manifest changes as regressions', () => {
    const before = manifest();
    const after = manifest({
      claudeCode: '2.1.263',
      suiteHash: hash('c'),
      evidenceHash: hash('d'),
      result: 'fail',
      failureFingerprints: [fingerprint('e')],
      metadata: { gitCommit: 'def456' },
    });

    const result = diffCompatibilityManifests(before, after);
    expect(result.changed).toBe(true);
    expect(result.impact).toBe('regression');
    expect(result.changes.map((change) => change.kind)).toEqual(expect.arrayContaining([
      'release',
      'suite-definition',
      'evidence',
      'result',
      'failure-fingerprints',
      'metadata',
    ]));
    expect(result.changes.find((change) => change.kind === 'result')?.explanation).toContain('direct regression evidence');
    expect(formatCompatibilityDiff(result)).toContain('[REGRESSION] Result changed from pass to fail');
  });

  it('explains evidence-only manifest refreshes separately from compatibility changes', () => {
    const result = diffCompatibilityManifests(
      manifest(),
      manifest({ evidenceHash: hash('c'), createdAt: '2026-09-07T19:00:00.000Z' }),
    );
    expect(result.impact).toBe('evidence');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe('evidence');
    expect(result.changes[0].explanation).toContain('recorded run evidence differs');
  });

  it('shows component version changes as one lock target change instead of remove/add noise', () => {
    const before = lock();
    const after = lock({
      claudeCode: '2.1.263',
      suites: [
        {
          component: 'demo-plugin',
          componentVersion: '1.1.0',
          suiteHash: hash('c'),
          evidenceHash: hash('d'),
        },
      ],
    });

    const result = diffCanaryLocks(before, after);
    expect(result.impact).toBe('compatibility');
    expect(result.changes.some((change) => change.kind === 'component-version')).toBe(true);
    expect(result.changes.some((change) => change.kind === 'component-added')).toBe(false);
    expect(result.changes.some((change) => change.kind === 'component-removed')).toBe(false);
    expect(formatCompatibilityDiff(result)).toContain('Claude Code upgraded from 2.1.262 to 2.1.263');
    expect(formatCompatibilityDiff(result)).toContain('different suite definition');
  });

  it('reports added and removed lock targets when component identities are genuinely different', () => {
    const before = lock({
      suites: [
        { component: 'plugin-a', componentVersion: '1.0.0', suiteHash: hash('a'), evidenceHash: hash('b') },
        { component: 'plugin-b', componentVersion: '1.0.0', suiteHash: hash('c'), evidenceHash: hash('d') },
      ],
    });
    const after = lock({
      suites: [
        { component: 'plugin-a', componentVersion: '1.0.0', suiteHash: hash('a'), evidenceHash: hash('b') },
        { component: 'plugin-c', componentVersion: '1.0.0', suiteHash: hash('e'), evidenceHash: hash('f') },
      ],
    });

    const result = diffCanaryLocks(before, after);
    expect(result.changes.some((change) => change.kind === 'component-removed' && change.component === 'plugin-b')).toBe(true);
    expect(result.changes.some((change) => change.kind === 'component-added' && change.component === 'plugin-c')).toBe(true);
  });
});
