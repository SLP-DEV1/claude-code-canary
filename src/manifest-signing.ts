import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  CompatibilityManifestSchema,
  loadCompatibilityManifest,
  sha256Canonical,
  type CompatibilityManifest,
} from './compatibility.js';

export const SignedCompatibilityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal('ed25519-sha256-canonical-json'),
  manifest: CompatibilityManifestSchema,
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  publicKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().min(1),
}).strict();

export type SignedCompatibilityManifest = z.infer<typeof SignedCompatibilityManifestSchema>;

export interface SignedCompatibilityVerification {
  passed: boolean;
  manifestHash: string;
  publicKeyFingerprint?: string;
  failures: string[];
}

function publicFingerprint(key: ReturnType<typeof createPublicKey>): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

function signaturePayload(manifestHash: string): Buffer {
  return Buffer.from(manifestHash, 'hex');
}

export function signCompatibilityManifest(manifestValue: CompatibilityManifest, privateKeyPem: string): SignedCompatibilityManifest {
  const manifest = CompatibilityManifestSchema.parse(manifestValue);
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Compatibility manifest signing requires an Ed25519 private key.');
  const publicKey = createPublicKey(privateKey);
  const manifestHash = sha256Canonical(manifest);
  return SignedCompatibilityManifestSchema.parse({
    schemaVersion: 1,
    algorithm: 'ed25519-sha256-canonical-json',
    manifest,
    manifestHash,
    publicKeyFingerprint: publicFingerprint(publicKey),
    signature: sign(null, signaturePayload(manifestHash), privateKey).toString('base64'),
  });
}

export function verifySignedCompatibilityManifest(
  signedValue: SignedCompatibilityManifest,
  publicKeyPem: string,
): SignedCompatibilityVerification {
  const signed = SignedCompatibilityManifestSchema.parse(signedValue);
  const failures: string[] = [];
  const manifestHash = sha256Canonical(signed.manifest);
  if (manifestHash !== signed.manifestHash) failures.push('Signed manifest hash does not match the embedded compatibility manifest.');

  let fingerprint: string | undefined;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') failures.push('Compatibility manifest verification requires an Ed25519 public key.');
    else {
      fingerprint = publicFingerprint(publicKey);
      if (fingerprint !== signed.publicKeyFingerprint) failures.push('Public key fingerprint does not match the signed manifest.');
      if (!verify(null, signaturePayload(signed.manifestHash), publicKey, Buffer.from(signed.signature, 'base64'))) {
        failures.push('Ed25519 compatibility manifest signature verification failed.');
      }
    }
  } catch (error) {
    failures.push(`Unable to load verification key: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { passed: failures.length === 0, manifestHash, publicKeyFingerprint: fingerprint, failures };
}

export async function loadSignedCompatibilityManifest(file: string): Promise<SignedCompatibilityManifest> {
  return SignedCompatibilityManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export async function writeSignedCompatibilityManifest(file: string, signed: SignedCompatibilityManifest): Promise<void> {
  await writeFile(file, `${JSON.stringify(SignedCompatibilityManifestSchema.parse(signed), null, 2)}\n`, 'utf8');
}

async function readKey(args: string[], fileFlag: string, envFlag: string): Promise<string> {
  const fileIndex = args.indexOf(fileFlag);
  const envIndex = args.indexOf(envFlag);
  if (fileIndex >= 0 && envIndex >= 0) throw new Error(`Use only one of ${fileFlag} or ${envFlag}.`);
  if (fileIndex >= 0) {
    const file = args[fileIndex + 1];
    if (!file) throw new Error(`${fileFlag} requires a file path.`);
    return readFile(file, 'utf8');
  }
  if (envIndex >= 0) {
    const name = args[envIndex + 1];
    if (!name) throw new Error(`${envFlag} requires an environment variable name.`);
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} is empty or unavailable.`);
    return value.replace(/\\n/g, '\n');
  }
  throw new Error(`Provide ${fileFlag} <file> or ${envFlag} <name>.`);
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function signHelp(): string {
  return `Usage: claude-canary compat sign <manifest.json> [options]\n\n` +
    `Options:\n` +
    `  --private-key <file>       Ed25519 private PEM file\n` +
    `  --private-key-env <name>   Read Ed25519 private PEM from an environment variable\n` +
    `  --output <file>            Output file (default: <manifest>.signed.json)\n` +
    `  --json                     Print the signed envelope as JSON\n` +
    `  --help                     Show this help\n`;
}

function verifyHelp(): string {
  return `Usage: claude-canary compat verify <signed.json> [options]\n\n` +
    `Options:\n` +
    `  --public-key <file>        Ed25519 public PEM file\n` +
    `  --public-key-env <name>    Read Ed25519 public PEM from an environment variable\n` +
    `  --json                     Print verification as JSON\n` +
    `  --help                     Show this help\n`;
}

export async function runCompatibilitySignCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { console.log(signHelp()); return; }
  const file = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (!file) throw new Error('compat sign requires a compatibility manifest JSON file.');
  const privateKeyPem = await readKey(args, '--private-key', '--private-key-env');
  const signed = signCompatibilityManifest(await loadCompatibilityManifest(file), privateKeyPem);
  const output = valueAfter(args, '--output') ?? file.replace(/\.json$/i, '') + '.signed.json';
  await writeSignedCompatibilityManifest(output, signed);
  if (args.includes('--json')) console.log(JSON.stringify(signed, null, 2));
  else console.log(`Signed compatibility manifest -> ${output}\nFingerprint: ${signed.publicKeyFingerprint}`);
}

export async function runCompatibilityVerifyCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { console.log(verifyHelp()); return; }
  const file = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (!file) throw new Error('compat verify requires a signed compatibility manifest JSON file.');
  const publicKeyPem = await readKey(args, '--public-key', '--public-key-env');
  const result = verifySignedCompatibilityManifest(await loadSignedCompatibilityManifest(file), publicKeyPem);
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (result.passed) console.log(`Signature OK: ${result.manifestHash}`);
  else console.error(`Signature verification failed:\n${result.failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exitCode = result.passed ? 0 : 4;
}
