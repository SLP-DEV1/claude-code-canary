import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

const PackFileSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const ScenarioPackSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1).optional(),
  capabilities: z.object({
    network: z.boolean().default(false),
    mutating: z.boolean().default(false),
  }).strict().default({ network: false, mutating: false }),
  files: z.array(PackFileSchema).min(1),
}).strict();

export type ScenarioPack = z.infer<typeof ScenarioPackSchema>;

export interface InspectedScenarioPack {
  root: string;
  manifest: ScenarioPack;
  verifiedFiles: string[];
}

function safeRelative(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Unsafe scenario pack path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

async function fileSha256(file: string): Promise<string> {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Scenario pack entry is not a regular file: ${file}`);
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function inspectScenarioPack(root: string, options: { allowUnsafe?: boolean } = {}): Promise<InspectedScenarioPack> {
  const resolvedRoot = path.resolve(root);
  const raw = await readFile(path.join(resolvedRoot, 'canary-pack.yml'), 'utf8');
  const manifest = ScenarioPackSchema.parse(YAML.parse(raw));
  if (!options.allowUnsafe && (manifest.capabilities.network || manifest.capabilities.mutating)) {
    throw new Error('Scenario pack declares network or mutating capabilities. Inspect it and pass allowUnsafe explicitly before installation.');
  }
  const verifiedFiles: string[] = [];
  for (const entry of manifest.files) {
    const relative = safeRelative(entry.path);
    const absolute = path.resolve(resolvedRoot, relative);
    if (!absolute.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Scenario pack path escapes root: ${relative}`);
    const actual = await fileSha256(absolute);
    if (actual !== entry.sha256) throw new Error(`Scenario pack checksum mismatch for ${relative}: expected ${entry.sha256}, got ${actual}`);
    verifiedFiles.push(relative);
  }
  return { root: resolvedRoot, manifest, verifiedFiles: verifiedFiles.sort() };
}

export async function installScenarioPack(sourceRoot: string, targetRoot: string, options: { allowUnsafe?: boolean; force?: boolean } = {}): Promise<InspectedScenarioPack> {
  const inspected = await inspectScenarioPack(sourceRoot, options);
  const target = path.resolve(targetRoot);
  await mkdir(target, { recursive: true });
  for (const relative of inspected.verifiedFiles) {
    const destination = path.resolve(target, relative);
    if (!destination.startsWith(`${target}${path.sep}`)) throw new Error(`Scenario pack destination escapes target root: ${relative}`);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!options.force) {
      try { await lstat(destination); throw new Error(`Refusing to overwrite existing scenario pack file: ${relative}`); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      }
    }
    await copyFile(path.join(inspected.root, relative), destination);
  }
  return inspected;
}
