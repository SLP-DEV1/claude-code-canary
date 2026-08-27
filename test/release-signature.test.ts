import { describe, expect, it } from 'vitest';
import * as openpgp from 'openpgp';
import {
  FIRST_SIGNED_MANIFEST_VERSION,
  manifestSignatureRequired,
  readAndValidateSigningKey,
  verifyDetachedManifestSignature,
} from '../src/release-signature.js';

describe('Claude Code release signature verification', () => {
  it('requires detached signatures starting at 2.1.89', () => {
    expect(FIRST_SIGNED_MANIFEST_VERSION).toBe('2.1.89');
    expect(manifestSignatureRequired('2.1.88')).toBe(false);
    expect(manifestSignatureRequired('2.1.89')).toBe(true);
    expect(manifestSignatureRequired('2.1.90')).toBe(true);
    expect(manifestSignatureRequired('2.2.0')).toBe(true);
    expect(manifestSignatureRequired('3.0.0')).toBe(true);
  });

  it('rejects a syntactically valid OpenPGP key with the wrong fingerprint', async () => {
    const generated = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'Canary test key', email: 'test@example.invalid' }],
      format: 'armored',
    });

    await expect(readAndValidateSigningKey(generated.publicKey)).rejects.toThrow(/fingerprint mismatch/i);
  }, 20_000);

  it('accepts binary and armored detached signatures and rejects a tampered manifest', async () => {
    const generated = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'Canary fixture', email: 'fixture@example.invalid' }],
      format: 'armored',
    });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: generated.privateKey });
    const publicKey = await openpgp.readKey({ armoredKey: generated.publicKey });
    const manifest = new TextEncoder().encode('{"version":"2.1.89"}\n');
    const message = await openpgp.createMessage({ binary: manifest });

    const binarySignature = await openpgp.sign({
      message,
      signingKeys: privateKey,
      detached: true,
      format: 'binary',
    });
    await expect(
      verifyDetachedManifestSignature(manifest, binarySignature as Uint8Array, publicKey),
    ).resolves.toBeUndefined();

    const armoredSignature = await openpgp.sign({
      message,
      signingKeys: privateKey,
      detached: true,
      format: 'armored',
    });
    await expect(
      verifyDetachedManifestSignature(manifest, new TextEncoder().encode(armoredSignature as string), publicKey),
    ).resolves.toBeUndefined();

    const tampered = new TextEncoder().encode('{"version":"2.1.90"}\n');
    await expect(
      verifyDetachedManifestSignature(tampered, binarySignature as Uint8Array, publicKey),
    ).rejects.toThrow(/verification failed/i);
  }, 20_000);
});
