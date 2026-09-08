import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { sha256Canonical } from './compatibility.js';
import { inspectScenarioPack } from './packs.js';

const HttpUrlSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Expected an absolute http(s) URL.');
const TagSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,49}$/);

export const ScenarioPackDiscoverySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('claude-code-canary-scenario-pack'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1).optional(),
  capabilities: z.object({ network: z.boolean(), mutating: z.boolean() }).strict(),
  tags: z.array(TagSchema).max(20).default([]),
  authors: z.array(z.string().min(1)).max(20).default([]),
  license: z.string().min(1).optional(),
  repository: HttpUrlSchema.optional(),
  homepage: HttpUrlSchema.optional(),
  manifest: z.literal('canary-pack.yml'),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  filesHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileCount: z.number().int().positive(),
}).strict();

export const ScenarioPackCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('claude-code-canary-scenario-pack-catalog'),
  packs: z.array(ScenarioPackDiscoverySchema),
}).strict();

export type ScenarioPackDiscovery = z.infer<typeof ScenarioPackDiscoverySchema>;
export type ScenarioPackCatalog = z.infer<typeof ScenarioPackCatalogSchema>;

export interface ScenarioPackDiscoveryOptions {
  tags?: string[];
  authors?: string[];
  license?: string;
  repository?: string;
  homepage?: string;
}

function normalizedList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))].sort();
}

export async function buildScenarioPackDiscovery(root: string, options: ScenarioPackDiscoveryOptions = {}): Promise<ScenarioPackDiscovery> {
  const inspected = await inspectScenarioPack(root, { allowUnsafe: true });
  return ScenarioPackDiscoverySchema.parse({
    schemaVersion: 1,
    kind: 'claude-code-canary-scenario-pack',
    name: inspected.manifest.name,
    version: inspected.manifest.version,
    description: inspected.manifest.description,
    capabilities: inspected.manifest.capabilities,
    tags: normalizedList(options.tags),
    authors: normalizedList(options.authors),
    license: options.license,
    repository: options.repository,
    homepage: options.homepage,
    manifest: 'canary-pack.yml',
    manifestHash: sha256Canonical(inspected.manifest),
    filesHash: sha256Canonical(inspected.manifest.files),
    fileCount: inspected.verifiedFiles.length,
  });
}

export function buildScenarioPackCatalog(entries: ScenarioPackDiscovery[]): ScenarioPackCatalog {
  const byIdentity = new Map<string, ScenarioPackDiscovery>();
  for (const value of entries) {
    const entry = ScenarioPackDiscoverySchema.parse(value);
    const key = `${entry.name}\u0000${entry.version}\u0000${entry.manifestHash}`;
    byIdentity.set(key, entry);
  }
  return ScenarioPackCatalogSchema.parse({
    schemaVersion: 1,
    kind: 'claude-code-canary-scenario-pack-catalog',
    packs: [...byIdentity.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.manifestHash.localeCompare(b.manifestHash)),
  });
}

export async function loadScenarioPackDiscovery(file: string): Promise<ScenarioPackDiscovery> {
  return ScenarioPackDiscoverySchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

function collectValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  return normalizedList(values);
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runPackMetadataCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: claude-canary pack metadata <pack-dir> [--output <file>] [--tag <tag>] [--author <name>] [--license <id>] [--repository <url>] [--homepage <url>] [--json]');
    return;
  }
  const root = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (!root) throw new Error('pack metadata requires a scenario pack directory.');
  const metadata = await buildScenarioPackDiscovery(root, {
    tags: collectValues(args, '--tag'),
    authors: collectValues(args, '--author'),
    license: valueAfter(args, '--license'),
    repository: valueAfter(args, '--repository'),
    homepage: valueAfter(args, '--homepage'),
  });
  const output = valueAfter(args, '--output') ?? path.join(root, 'canary-pack.discovery.json');
  await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  if (args.includes('--json')) console.log(JSON.stringify(metadata, null, 2));
  else console.log(`Scenario pack discovery metadata -> ${output}`);
}

export async function runPackCatalogCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: claude-canary pack catalog <metadata.json>... --output <catalog.json> [--json]');
    return;
  }
  const output = valueAfter(args, '--output');
  if (!output) throw new Error('pack catalog requires --output <catalog.json>.');
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--output') { index += 1; continue; }
    if (value.startsWith('-')) continue;
    files.push(value);
  }
  if (!files.length) throw new Error('pack catalog requires at least one discovery metadata file.');
  const catalog = buildScenarioPackCatalog(await Promise.all(files.map(loadScenarioPackDiscovery)));
  await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  if (args.includes('--json')) console.log(JSON.stringify(catalog, null, 2));
  else console.log(`Scenario pack catalog (${catalog.packs.length} pack entries) -> ${output}`);
}
