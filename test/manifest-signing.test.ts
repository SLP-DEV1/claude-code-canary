import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  signCompatibilityManifest,
  verifySignedCompatibilityManifest,
} from '../src/manifest-signing.js';
import type { CompatibilityManifest } from '../src/compatibility.js';

function manifest(): CompatibilityManifest {
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
  };
}

function pemKeys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('signed compatibility manifests', () => {
  it('signs deterministically and verifies against the matching key', () => {
    const keys = pemKeys();
    const a = signCompatibilityManifest(manifest(), keys.privateKey);
    const b = signCompatibilityManifest(manifest(), keys.privateKey);
    expect(a).toEqual(b);
    expect(verifySignedCompatibilityManifest(a, keys.publicKey)).toMatchObject({ passed: true, failures: [] });
  });

  it('fails closed when the embedded manifest is changed', () => {
    const keys = pemKeys();
    const signed = signCompatibilityManifest(manifest(), keys.privateKey);
    const tampered = structuredClone(signed);
    tampered.manifest.result = 'fail';
    const result = verifySignedCompatibilityManifest(tampered, keys.publicKey);
    expect(result.passed).toBe(false);
    expect(result.failures.join('\n')).toMatch(/hash does not match/i);
  });

  it('rejects a different public key', () => {
    const keys = pemKeys();
    const other = pemKeys();
    const signed = signCompatibilityManifest(manifest(), keys.privateKey);
    const result = verifySignedCompatibilityManifest(signed, other.publicKey);
    expect(result.passed).toBe(false);
    expect(result.failures.join('\n')).toMatch(/fingerprint|signature/i);
  });
});
