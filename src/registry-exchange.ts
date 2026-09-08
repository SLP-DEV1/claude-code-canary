import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  CompatibilityRegistrySchema,
  queryCompatibility,
  sha256Canonical,
  type CompatibilityManifest,
  type CompatibilityQuery,
  type CompatibilityRegistry,
} from './compatibility.js';

export const RegistryExchangeConflictSchema = z.object({
  identity: z.string().min(1),
  kind: z.enum(['result', 'evidence']),
  manifestHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(2),
  results: z.array(z.enum(['pass', 'fail', 'unsupported'])).min(1),
}).strict();

export type RegistryExchangeConflict = z.infer<typeof RegistryExchangeConflictSchema>;

export interface RegistryImportResult {
  registry: CompatibilityRegistry;
  conflicts: RegistryExchangeConflict[];
  added: number;
  duplicates: number;
}

function identity(manifest: CompatibilityManifest): string {
  return [manifest.component, manifest.componentVersion ?? '', manifest.platform, manifest.claudeCode].join('|');
}

function latestGeneratedAt(registries: CompatibilityRegistry[]): string {
  return [...registries.map((registry) => registry.generatedAt)].sort().at(-1) ?? new Date(0).toISOString();
}

function findConflicts(manifests: CompatibilityManifest[]): RegistryExchangeConflict[] {
  const groups = new Map<string, CompatibilityManifest[]>();
  for (const manifest of manifests) {
    const key = identity(manifest);
    groups.set(key, [...(groups.get(key) ?? []), manifest]);
  }
  const conflicts: RegistryExchangeConflict[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const hashes = [...new Set(entries.map((manifest) => sha256Canonical(manifest)))].sort();
    if (hashes.length < 2) continue;
    const results = [...new Set(entries.map((manifest) => manifest.result))].sort() as CompatibilityManifest['result'][];
    const evidence = new Set(entries.map((manifest) => `${manifest.evidenceHash}:${manifest.suiteHash}`));
    conflicts.push(RegistryExchangeConflictSchema.parse({
      identity: key,
      kind: results.length > 1 ? 'result' : 'evidence',
      manifestHashes: hashes,
      results,
    }));
    if (evidence.size === 1 && results.length === 1) conflicts.pop();
  }
  return conflicts.sort((a, b) => a.identity.localeCompare(b.identity) || a.kind.localeCompare(b.kind));
}

export function exportCompatibilityRegistry(
  registryValue: CompatibilityRegistry,
  query: CompatibilityQuery = {},
  options: { name?: string } = {},
): CompatibilityRegistry {
  const registry = CompatibilityRegistrySchema.parse(registryValue);
  return CompatibilityRegistrySchema.parse({
    schemaVersion: 1,
    name: options.name ?? `${registry.name}-export`,
    generatedAt: registry.generatedAt,
    manifests: queryCompatibility(registry, query)
      .slice()
      .sort((a, b) => identity(a).localeCompare(identity(b)) || sha256Canonical(a).localeCompare(sha256Canonical(b))),
  });
}

export function importCompatibilityRegistries(
  baseValue: CompatibilityRegistry,
  incomingValues: CompatibilityRegistry[],
  options: { name?: string; allowResultConflicts?: boolean } = {},
): RegistryImportResult {
  const registries = [CompatibilityRegistrySchema.parse(baseValue), ...incomingValues.map((value) => CompatibilityRegistrySchema.parse(value))];
  const byManifest = new Map<string, CompatibilityManifest>();
  let duplicates = 0;
  for (const registry of registries) {
    for (const manifest of registry.manifests) {
      const hash = sha256Canonical(manifest);
      if (byManifest.has(hash)) duplicates += 1;
      else byManifest.set(hash, manifest);
    }
  }
  const manifests = [...byManifest.values()].sort((a, b) => identity(a).localeCompare(identity(b)) || sha256Canonical(a).localeCompare(sha256Canonical(b)));
  const conflicts = findConflicts(manifests);
  const resultConflicts = conflicts.filter((conflict) => conflict.kind === 'result');
  if (resultConflicts.length > 0 && !options.allowResultConflicts) {
    throw new Error(`Registry import found ${resultConflicts.length} contradictory result conflict(s). Re-run with --allow-result-conflicts only after reviewing them.`);
  }
  return {
    registry: CompatibilityRegistrySchema.parse({
      schemaVersion: 1,
      name: options.name ?? baseValue.name,
      generatedAt: latestGeneratedAt(registries),
      manifests,
    }),
    conflicts,
    added: Math.max(0, manifests.length - baseValue.manifests.length),
    duplicates,
  };
}

async function loadRegistry(file: string): Promise<CompatibilityRegistry> {
  return CompatibilityRegistrySchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positional(args: string[], flagsWithValues: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (flagsWithValues.includes(value)) { index += 1; continue; }
    if (value.startsWith('-')) continue;
    values.push(value);
  }
  return values;
}

export async function runRegistryExportCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: claude-canary registry export <registry.json> --output <file> [--name <name>] [--component <name>] [--component-version <ver>] [--platform <id>] [--claude <ver>] [--result <pass|fail|unsupported>] [--json]');
    return;
  }
  const files = positional(args, ['--output', '--name', '--component', '--component-version', '--platform', '--claude', '--result']);
  if (files.length !== 1) throw new Error('registry export requires exactly one source registry JSON file.');
  const output = valueAfter(args, '--output');
  if (!output) throw new Error('registry export requires --output <file>.');
  const resultValue = valueAfter(args, '--result') as CompatibilityQuery['result'];
  if (resultValue && !['pass', 'fail', 'unsupported'].includes(resultValue)) throw new Error('--result must be pass, fail, or unsupported.');
  const registry = exportCompatibilityRegistry(await loadRegistry(files[0]), {
    component: valueAfter(args, '--component'),
    componentVersion: valueAfter(args, '--component-version'),
    platform: valueAfter(args, '--platform'),
    claudeCode: valueAfter(args, '--claude'),
    result: resultValue,
  }, { name: valueAfter(args, '--name') });
  await writeFile(output, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  if (args.includes('--json')) console.log(JSON.stringify(registry, null, 2));
  else console.log(`Exported ${registry.manifests.length} compatibility manifest(s) -> ${output}`);
}

export async function runRegistryImportCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: claude-canary registry import <base.json> <incoming.json>... --output <file> [--name <name>] [--allow-result-conflicts] [--json]');
    return;
  }
  const files = positional(args, ['--output', '--name']);
  if (files.length < 2) throw new Error('registry import requires a base registry and at least one incoming registry.');
  const output = valueAfter(args, '--output');
  if (!output) throw new Error('registry import requires --output <file>.');
  const base = await loadRegistry(files[0]);
  const imported = importCompatibilityRegistries(base, await Promise.all(files.slice(1).map(loadRegistry)), {
    name: valueAfter(args, '--name'),
    allowResultConflicts: args.includes('--allow-result-conflicts'),
  });
  await writeFile(output, `${JSON.stringify(imported.registry, null, 2)}\n`, 'utf8');
  const summary = { output, manifests: imported.registry.manifests.length, added: imported.added, duplicates: imported.duplicates, conflicts: imported.conflicts };
  if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else console.log(`Imported registry -> ${output} (${imported.added} added, ${imported.duplicates} duplicate(s), ${imported.conflicts.length} conflict(s))`);
}
