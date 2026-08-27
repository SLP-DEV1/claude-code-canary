import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CANARY_VERSION } from './version.js';

export const CompatibilityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  canaryVersion: z.string().min(1),
  claudeCode: z.string().regex(/^\d+\.\d+\.\d+$/),
  component: z.string().min(1),
  componentVersion: z.string().min(1).optional(),
  platform: z.string().min(1),
  suiteHash: z.string().regex(/^[0-9a-f]{64}$/),
  result: z.enum(['pass', 'fail', 'unsupported']),
  createdAt: z.string().min(1),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  failureFingerprints: z.array(z.string().regex(/^[0-9a-f]{16}$/)).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
}).strict();

export type CompatibilityManifest = z.infer<typeof CompatibilityManifestSchema>;

export const CanaryLockSchema = z.object({
  schemaVersion: z.literal(1),
  canaryVersion: z.string().min(1),
  claudeCode: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.string().min(1),
  suites: z.array(z.object({
    component: z.string().min(1),
    componentVersion: z.string().min(1).optional(),
    suiteHash: z.string().regex(/^[0-9a-f]{64}$/),
    evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).min(1),
  generatedAt: z.string().min(1),
}).strict();

export type CanaryLock = z.infer<typeof CanaryLockSchema>;

export const CompatibilityRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  generatedAt: z.string().min(1),
  manifests: z.array(CompatibilityManifestSchema),
}).strict();

export type CompatibilityRegistry = z.infer<typeof CompatibilityRegistrySchema>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function createCompatibilityManifest(input: {
  claudeCode: string;
  component: string;
  componentVersion?: string;
  platform: string;
  suiteDefinition: unknown;
  result: CompatibilityManifest['result'];
  evidence: unknown;
  failureFingerprints?: string[];
  metadata?: Record<string, string>;
  canaryVersion?: string;
}): CompatibilityManifest {
  return CompatibilityManifestSchema.parse({
    schemaVersion: 1,
    canaryVersion: input.canaryVersion ?? CANARY_VERSION,
    claudeCode: input.claudeCode,
    component: input.component,
    componentVersion: input.componentVersion,
    platform: input.platform,
    suiteHash: sha256Canonical(input.suiteDefinition),
    result: input.result,
    createdAt: new Date().toISOString(),
    evidenceHash: sha256Canonical(input.evidence),
    failureFingerprints: [...new Set(input.failureFingerprints ?? [])].sort(),
    metadata: input.metadata ?? {},
  });
}

export async function writeCompatibilityManifest(file: string, manifest: CompatibilityManifest): Promise<void> {
  await writeFile(file, `${JSON.stringify(CompatibilityManifestSchema.parse(manifest), null, 2)}\n`, 'utf8');
}

export async function loadCompatibilityManifest(file: string): Promise<CompatibilityManifest> {
  return CompatibilityManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export async function loadCompatibilityRegistry(file: string): Promise<CompatibilityRegistry> {
  return CompatibilityRegistrySchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export async function writeCompatibilityRegistry(file: string, registry: CompatibilityRegistry): Promise<void> {
  await writeFile(file, `${JSON.stringify(CompatibilityRegistrySchema.parse(registry), null, 2)}\n`, 'utf8');
}

export function createCanaryLock(manifests: CompatibilityManifest[]): CanaryLock {
  if (!manifests.length) throw new Error('At least one compatibility manifest is required to create canary.lock.');
  const first = manifests[0];
  for (const manifest of manifests) {
    if (manifest.claudeCode !== first.claudeCode) throw new Error('All lockfile manifests must use the same Claude Code release.');
    if (manifest.platform !== first.platform) throw new Error('All lockfile manifests must use the same platform.');
  }
  return CanaryLockSchema.parse({
    schemaVersion: 1,
    canaryVersion: CANARY_VERSION,
    claudeCode: first.claudeCode,
    platform: first.platform,
    suites: manifests.map((manifest) => ({
      component: manifest.component,
      componentVersion: manifest.componentVersion,
      suiteHash: manifest.suiteHash,
      evidenceHash: manifest.evidenceHash,
    })).sort((a, b) => a.component.localeCompare(b.component)),
    generatedAt: new Date().toISOString(),
  });
}

export async function writeCanaryLock(file: string, lock: CanaryLock): Promise<void> {
  await writeFile(file, `${JSON.stringify(CanaryLockSchema.parse(lock), null, 2)}\n`, 'utf8');
}

export async function loadCanaryLock(file: string): Promise<CanaryLock> {
  return CanaryLockSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export function checkCanaryLock(lock: CanaryLock, current: { claudeCode: string; platform: string; manifests?: CompatibilityManifest[] }): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (current.claudeCode !== lock.claudeCode) failures.push(`Claude Code drift: lock=${lock.claudeCode}, current=${current.claudeCode}`);
  if (current.platform !== lock.platform) failures.push(`Platform drift: lock=${lock.platform}, current=${current.platform}`);
  if (current.manifests) {
    for (const expected of lock.suites) {
      const actual = current.manifests.find((manifest) => manifest.component === expected.component && manifest.componentVersion === expected.componentVersion);
      if (!actual) failures.push(`Missing compatibility evidence for ${expected.component}${expected.componentVersion ? `@${expected.componentVersion}` : ''}`);
      else {
        if (actual.suiteHash !== expected.suiteHash) failures.push(`Suite drift for ${expected.component}: ${expected.suiteHash} != ${actual.suiteHash}`);
        if (actual.evidenceHash !== expected.evidenceHash) failures.push(`Evidence drift for ${expected.component}: ${expected.evidenceHash} != ${actual.evidenceHash}`);
      }
    }
  }
  return { passed: failures.length === 0, failures };
}

export function mergeCompatibilityRegistries(name: string, registries: CompatibilityRegistry[]): CompatibilityRegistry {
  const byEvidence = new Map<string, CompatibilityManifest>();
  for (const registry of registries) for (const manifest of registry.manifests) byEvidence.set(manifest.evidenceHash, manifest);
  return CompatibilityRegistrySchema.parse({
    schemaVersion: 1,
    name,
    generatedAt: new Date().toISOString(),
    manifests: [...byEvidence.values()].sort((a, b) => a.component.localeCompare(b.component) || compareVersion(a.claudeCode, b.claudeCode)),
  });
}

export async function aggregateRegistryFiles(name: string, files: string[]): Promise<CompatibilityRegistry> {
  if (!files.length) throw new Error('At least one registry file is required.');
  return mergeCompatibilityRegistries(name, await Promise.all(files.map(loadCompatibilityRegistry)));
}

export interface CompatibilityQuery {
  component?: string;
  componentVersion?: string;
  platform?: string;
  claudeCode?: string;
  result?: CompatibilityManifest['result'];
}

export function queryCompatibility(registry: CompatibilityRegistry, query: CompatibilityQuery): CompatibilityManifest[] {
  return registry.manifests.filter((manifest) =>
    (!query.component || manifest.component === query.component) &&
    (!query.componentVersion || manifest.componentVersion === query.componentVersion) &&
    (!query.platform || manifest.platform === query.platform) &&
    (!query.claudeCode || manifest.claudeCode === query.claudeCode) &&
    (!query.result || manifest.result === query.result)
  );
}

function versionParts(version: string): number[] { return version.split('.').map(Number); }
export function compareVersion(a: string, b: string): number {
  const aa = versionParts(a); const bb = versionParts(b);
  for (let i = 0; i < 3; i += 1) if (aa[i] !== bb[i]) return (aa[i] ?? 0) - (bb[i] ?? 0);
  return 0;
}

export function newestKnownGood(registry: CompatibilityRegistry, query: Omit<CompatibilityQuery, 'claudeCode' | 'result'>): CompatibilityManifest | undefined {
  return queryCompatibility(registry, { ...query, result: 'pass' }).sort((a, b) => compareVersion(b.claudeCode, a.claudeCode))[0];
}

export function firstKnownBad(
  registry: CompatibilityRegistry,
  query: Omit<CompatibilityQuery, 'claudeCode' | 'result'>,
  from?: string,
  to?: string,
): CompatibilityManifest | undefined {
  return queryCompatibility(registry, query)
    .filter((manifest) => manifest.result === 'fail')
    .filter((manifest) => !from || compareVersion(manifest.claudeCode, from) >= 0)
    .filter((manifest) => !to || compareVersion(manifest.claudeCode, to) <= 0)
    .sort((a, b) => compareVersion(a.claudeCode, b.claudeCode))[0];
}

export interface CompatibilityExplanation {
  component: string;
  from?: string;
  to?: string;
  tested: CompatibilityManifest[];
  newestGood?: CompatibilityManifest;
  firstBad?: CompatibilityManifest;
  status: 'no-evidence' | 'compatible' | 'regression-known' | 'mixed';
  evidenceHashes: string[];
  failureFingerprints: string[];
}

export function explainCompatibility(
  registry: CompatibilityRegistry,
  query: Omit<CompatibilityQuery, 'claudeCode' | 'result'> & { component: string },
  from?: string,
  to?: string,
): CompatibilityExplanation {
  const tested = queryCompatibility(registry, query)
    .filter((manifest) => !from || compareVersion(manifest.claudeCode, from) >= 0)
    .filter((manifest) => !to || compareVersion(manifest.claudeCode, to) <= 0)
    .sort((a, b) => compareVersion(a.claudeCode, b.claudeCode));
  const goods = tested.filter((manifest) => manifest.result === 'pass');
  const bads = tested.filter((manifest) => manifest.result === 'fail');
  const newestGood = goods.sort((a, b) => compareVersion(b.claudeCode, a.claudeCode))[0];
  const firstBad = bads.sort((a, b) => compareVersion(a.claudeCode, b.claudeCode))[0];
  let status: CompatibilityExplanation['status'];
  if (!tested.length) status = 'no-evidence';
  else if (!bads.length) status = 'compatible';
  else if (firstBad && newestGood && compareVersion(firstBad.claudeCode, newestGood.claudeCode) > 0) status = 'regression-known';
  else status = 'mixed';
  return {
    component: query.component,
    from,
    to,
    tested,
    newestGood,
    firstBad,
    status,
    evidenceHashes: [...new Set(tested.map((manifest) => manifest.evidenceHash))].sort(),
    failureFingerprints: [...new Set(tested.flatMap((manifest) => manifest.failureFingerprints))].sort(),
  };
}

export interface CompatibilityGraph {
  nodes: Array<{ id: string; kind: 'component' | 'claude-code' | 'platform' | 'canary'; label: string }>;
  edges: Array<{ from: string; to: string; result: CompatibilityManifest['result']; evidenceHash: string }>;
}

export function buildCompatibilityGraph(registry: CompatibilityRegistry): CompatibilityGraph {
  const nodes = new Map<string, CompatibilityGraph['nodes'][number]>();
  const edges: CompatibilityGraph['edges'] = [];
  for (const manifest of registry.manifests) {
    const componentLabel = `${manifest.component}${manifest.componentVersion ? `@${manifest.componentVersion}` : ''}`;
    const componentId = `component:${componentLabel}`;
    const releaseId = `claude:${manifest.claudeCode}`;
    const platformId = `platform:${manifest.platform}`;
    const canaryId = `canary:${manifest.canaryVersion}`;
    nodes.set(componentId, { id: componentId, kind: 'component', label: componentLabel });
    nodes.set(releaseId, { id: releaseId, kind: 'claude-code', label: manifest.claudeCode });
    nodes.set(platformId, { id: platformId, kind: 'platform', label: manifest.platform });
    nodes.set(canaryId, { id: canaryId, kind: 'canary', label: manifest.canaryVersion });
    edges.push({ from: componentId, to: releaseId, result: manifest.result, evidenceHash: manifest.evidenceHash });
    edges.push({ from: releaseId, to: platformId, result: manifest.result, evidenceHash: manifest.evidenceHash });
    edges.push({ from: componentId, to: canaryId, result: manifest.result, evidenceHash: manifest.evidenceHash });
  }
  return { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.evidenceHash.localeCompare(b.evidenceHash)) };
}

export function compatibilityBadgeMarkdown(manifest: CompatibilityManifest): string {
  const label = encodeURIComponent(`Claude Code ${manifest.claudeCode}`);
  const message = encodeURIComponent(manifest.result);
  const color = manifest.result === 'pass' ? 'brightgreen' : manifest.result === 'fail' ? 'red' : 'lightgrey';
  return `![${manifest.component} compatibility](https://img.shields.io/badge/${label}-${message}-${color})`;
}
