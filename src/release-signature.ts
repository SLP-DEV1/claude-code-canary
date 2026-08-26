import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as openpgp from 'openpgp';

const SIGNING_KEY_URL = 'https://downloads.claude.ai/keys/claude-code.asc';
const RELEASE_BASE = 'https://downloads.claude.ai/claude-code-releases';
export const CLAUDE_CODE_SIGNING_FINGERPRINT = '31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE';
export const FIRST_SIGNED_MANIFEST_VERSION = '2.1.89';

export type ManifestVerification =
  | { mode: 'signed'; fingerprint: string }
  | { mode: 'checksum-only'; fingerprint: null };

function normalizeFingerprint(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function versionTuple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid Claude Code version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function manifestSignatureRequired(version: string): boolean {
  const a = versionTuple(version);
  const b = versionTuple(FIRST_SIGNED_MANIFEST_VERSION);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url));
}

export async function readAndValidateSigningKey(armoredKey: string): Promise<openpgp.PublicKey> {
  let key: openpgp.PublicKey;
  try {
    key = await openpgp.readKey({ armoredKey });
  } catch (error) {
    throw new Error(`Unable to parse Anthropic Claude Code signing key: ${error instanceof Error ? error.message : String(error)}`);
  }

  const fingerprint = normalizeFingerprint(key.getFingerprint());
  if (fingerprint !== CLAUDE_CODE_SIGNING_FINGERPRINT) {
    throw new Error(
      `Anthropic signing-key fingerprint mismatch: expected ${CLAUDE_CODE_SIGNING_FINGERPRINT}, got ${fingerprint}`,
    );
  }
  return key;
}

async function loadPinnedSigningKey(cacheRoot: string): Promise<openpgp.PublicKey> {
  const trustDir = path.join(cacheRoot, 'trust');
  const keyPath = path.join(trustDir, 'claude-code.asc');
  await mkdir(trustDir, { recursive: true });

  try {
    const cached = await readFile(keyPath, 'utf8');
    return await readAndValidateSigningKey(cached);
  } catch {
    // Missing or invalid local cache: replace it only with a freshly fetched key
    // whose fingerprint matches the hard-coded Anthropic fingerprint.
  }

  const armoredKey = await fetchText(SIGNING_KEY_URL);
  const key = await readAndValidateSigningKey(armoredKey);
  const temporary = `${keyPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, armoredKey, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, keyPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return key;
}

export async function verifyDetachedManifestSignature(
  manifestBytes: Uint8Array,
  signatureBytes: Uint8Array,
  verificationKey: openpgp.PublicKey,
): Promise<void> {
  let signature: openpgp.Signature;
  try {
    signature = await openpgp.readSignature({ binarySignature: signatureBytes });
  } catch (error) {
    throw new Error(`Invalid detached release signature: ${error instanceof Error ? error.message : String(error)}`);
  }

  const message = await openpgp.createMessage({ binary: manifestBytes });
  const result = await openpgp.verify({
    message,
    signature,
    verificationKeys: verificationKey,
  });

  if (result.signatures.length !== 1) {
    throw new Error(`Expected exactly one Anthropic manifest signature, got ${result.signatures.length}`);
  }

  try {
    await result.signatures[0].verified;
  } catch (error) {
    throw new Error(`Claude Code manifest signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function verifyReleaseManifest(
  version: string,
  manifestBytes: Uint8Array,
  cacheRoot: string,
): Promise<ManifestVerification> {
  if (!manifestSignatureRequired(version)) {
    return { mode: 'checksum-only', fingerprint: null };
  }

  const key = await loadPinnedSigningKey(cacheRoot);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = await fetchBytes(`${RELEASE_BASE}/${version}/manifest.json.sig`);
  } catch (error) {
    throw new Error(
      `Claude Code ${version} requires a signed manifest, but its detached signature could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await verifyDetachedManifestSignature(manifestBytes, signatureBytes, key);
  return { mode: 'signed', fingerprint: CLAUDE_CODE_SIGNING_FINGERPRINT };
}
