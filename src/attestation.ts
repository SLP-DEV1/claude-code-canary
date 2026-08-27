import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface BundleAttestationFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface BundleAttestation {
  schemaVersion: 1;
  algorithm: 'sha256' | 'ed25519-sha256-manifest';
  createdAt: string;
  files: BundleAttestationFile[];
  manifestHash: string;
  publicKeyFingerprint?: string;
  signature?: string;
}

async function walk(root: string, current = root, output: string[] = []): Promise<string[]> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, output);
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

async function describeFile(root: string, file: string): Promise<BundleAttestationFile> {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Attestation refuses non-regular file: ${file}`);
  const bytes = await readFile(file);
  return {
    path: path.relative(root, file).replace(/\\/g, '/'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

function manifestBytes(files: BundleAttestationFile[]): Buffer {
  return Buffer.from(JSON.stringify(files.map((file) => ({ path: file.path, sha256: file.sha256, bytes: file.bytes }))));
}

function publicFingerprint(key: ReturnType<typeof createPublicKey>): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export async function createBundleAttestation(root: string, options: { privateKeyPem?: string; exclude?: string[] } = {}): Promise<BundleAttestation> {
  const resolved = path.resolve(root);
  const excluded = new Set((options.exclude ?? []).map((value) => value.replace(/\\/g, '/')));
  const files: BundleAttestationFile[] = [];
  for (const file of (await walk(resolved)).sort()) {
    const relative = path.relative(resolved, file).replace(/\\/g, '/');
    if (excluded.has(relative)) continue;
    files.push(await describeFile(resolved, file));
  }
  const payload = manifestBytes(files);
  const manifestHash = createHash('sha256').update(payload).digest('hex');
  if (!options.privateKeyPem) {
    return { schemaVersion: 1, algorithm: 'sha256', createdAt: new Date().toISOString(), files, manifestHash };
  }
  const privateKey = createPrivateKey(options.privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Bundle signing requires an Ed25519 private key.');
  const publicKey = createPublicKey(privateKey);
  return {
    schemaVersion: 1,
    algorithm: 'ed25519-sha256-manifest',
    createdAt: new Date().toISOString(),
    files,
    manifestHash,
    publicKeyFingerprint: publicFingerprint(publicKey),
    signature: sign(null, payload, privateKey).toString('base64'),
  };
}

export async function verifyBundleAttestation(root: string, attestation: BundleAttestation, options: { publicKeyPem?: string } = {}): Promise<{ passed: boolean; failures: string[] }> {
  const resolved = path.resolve(root);
  const failures: string[] = [];
  const actual: BundleAttestationFile[] = [];
  for (const expected of attestation.files) {
    const normalized = expected.path.replace(/\\/g, '/');
    if (path.posix.isAbsolute(normalized) || normalized.startsWith('../') || normalized.includes('/../')) {
      failures.push(`Unsafe attested path: ${expected.path}`);
      continue;
    }
    try { actual.push(await describeFile(resolved, path.join(resolved, normalized))); }
    catch (error) { failures.push(`Missing/unreadable ${normalized}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const expectedByPath = new Map(attestation.files.map((file) => [file.path, file]));
  for (const file of actual) {
    const expected = expectedByPath.get(file.path);
    if (!expected || expected.sha256 !== file.sha256 || expected.bytes !== file.bytes) failures.push(`Integrity mismatch: ${file.path}`);
  }
  const payload = manifestBytes(attestation.files);
  const hash = createHash('sha256').update(payload).digest('hex');
  if (hash !== attestation.manifestHash) failures.push('Attestation manifest hash is invalid.');
  if (attestation.signature) {
    if (!options.publicKeyPem) failures.push('Attestation is signed but no public key was provided.');
    else {
      const publicKey = createPublicKey(options.publicKeyPem);
      if (attestation.publicKeyFingerprint && publicFingerprint(publicKey) !== attestation.publicKeyFingerprint) failures.push('Public key fingerprint does not match attestation.');
      if (!verify(null, payload, publicKey, Buffer.from(attestation.signature, 'base64'))) failures.push('Ed25519 signature verification failed.');
    }
  }
  return { passed: failures.length === 0, failures };
}
