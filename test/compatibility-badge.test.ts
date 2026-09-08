import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCompatibilityBadgeMetadata,
  publishCompatibilityBadge,
  renderCompatibilityBadgeSvg,
} from '../src/compatibility-badge.js';
import type { CompatibilityManifest } from '../src/compatibility.js';

function manifest(): CompatibilityManifest {
  return {
    schemaVersion: 1,
    canaryVersion: '2.0.0',
    claudeCode: '2.1.264',
    component: 'plugin-<alpha>',
    componentVersion: '1.0.0',
    platform: 'linux-x64',
    suiteHash: 'a'.repeat(64),
    result: 'pass',
    createdAt: '2026-09-08T12:00:00.000Z',
    evidenceHash: 'b'.repeat(64),
    failureFingerprints: [],
    metadata: {},
  };
}

describe('evidence-backed compatibility badges', () => {
  it('renders a standalone SVG without leaking unescaped manifest text', () => {
    const svg = renderCompatibilityBadgeSvg(manifest());
    expect(svg).toContain('<svg');
    expect(svg).toContain('Claude Code 2.1.264');
    expect(svg).toContain('plugin-&lt;alpha&gt;');
    expect(svg).not.toContain('plugin-<alpha>');
    expect(svg).toContain('b'.repeat(64));
  });

  it('binds badge metadata to manifest, evidence, suite and target', () => {
    const metadata = buildCompatibilityBadgeMetadata(manifest(), { evidenceUrl: 'https://example.test/evidence/123' });
    expect(metadata.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(metadata.evidenceHash).toBe('b'.repeat(64));
    expect(metadata.suiteHash).toBe('a'.repeat(64));
    expect(metadata.evidenceUrl).toBe('https://example.test/evidence/123');
  });

  it('publishes svg, metadata, manifest and linked markdown', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canary-badge-'));
    const source = path.join(root, 'manifest.json');
    await writeFile(source, `${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');
    const result = await publishCompatibilityBadge(source, path.join(root, 'out'), {
      baseUrl: 'https://example.test/badges/plugin-alpha',
      evidenceUrl: 'https://example.test/evidence/abc',
    });
    expect(await readFile(result.badgePath, 'utf8')).toContain('<svg');
    expect(JSON.parse(await readFile(result.metadataPath, 'utf8')).evidenceHash).toBe('b'.repeat(64));
    const markdown = await readFile(result.markdownPath, 'utf8');
    expect(markdown).toContain('https://example.test/badges/plugin-alpha/badge.svg');
    expect(markdown).toContain('https://example.test/evidence/abc');
  });
});
