import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  CompatibilityRegistrySchema,
  compareVersion,
  loadCompatibilityRegistry,
  sha256Canonical,
  type CompatibilityManifest,
  type CompatibilityRegistry,
} from './compatibility.js';

export const StaticRegistryReleaseSchema = z.object({
  claudeCode: z.string().regex(/^\d+\.\d+\.\d+$/),
  result: z.enum(['pass', 'fail', 'unsupported']),
  createdAt: z.string().min(1),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  suiteHash: z.string().regex(/^[0-9a-f]{64}$/),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  manifest: z.string().min(1),
}).strict();

export const StaticRegistryComponentSchema = z.object({
  component: z.string().min(1),
  componentVersion: z.string().min(1).optional(),
  platform: z.string().min(1),
  releases: z.array(StaticRegistryReleaseSchema),
}).strict();

export const StaticRegistryIndexSchema = z.object({
  schemaVersion: z.literal(1),
  registrySchemaVersion: z.literal(1),
  name: z.string().min(1),
  generatedAt: z.string().min(1),
  manifestCount: z.number().int().nonnegative(),
  registry: z.literal('registry.json'),
  checksumFile: z.literal('SHA256SUMS'),
  baseUrl: z.string().url().optional(),
  components: z.array(StaticRegistryComponentSchema),
}).strict();

export type StaticRegistryRelease = z.infer<typeof StaticRegistryReleaseSchema>;
export type StaticRegistryComponent = z.infer<typeof StaticRegistryComponentSchema>;
export type StaticRegistryIndex = z.infer<typeof StaticRegistryIndexSchema>;

export interface StaticRegistryPublishOptions {
  baseUrl?: string;
  html?: boolean;
}

export interface StaticRegistryPublishResult {
  schemaVersion: 1;
  outputDir: string;
  registryPath: string;
  indexPath: string;
  checksumPath: string;
  htmlPath?: string;
  manifestCount: number;
  componentCount: number;
  files: string[];
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeBaseUrl(value?: string): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('--base-url must be an absolute http(s) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('--base-url must be an absolute http(s) URL without credentials, query, or fragment.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function manifestHash(manifest: CompatibilityManifest): string {
  return sha256Canonical(manifest);
}

function manifestPath(manifest: CompatibilityManifest): string {
  return `manifests/${manifestHash(manifest)}.json`;
}

function groupKey(manifest: CompatibilityManifest): string {
  return JSON.stringify([manifest.component, manifest.componentVersion ?? '', manifest.platform]);
}

export function buildStaticRegistryIndex(
  registryValue: CompatibilityRegistry,
  options: Pick<StaticRegistryPublishOptions, 'baseUrl'> = {},
): StaticRegistryIndex {
  const registry = CompatibilityRegistrySchema.parse(registryValue);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const groups = new Map<string, StaticRegistryComponent>();

  for (const manifest of registry.manifests) {
    const key = groupKey(manifest);
    const group = groups.get(key) ?? {
      component: manifest.component,
      componentVersion: manifest.componentVersion,
      platform: manifest.platform,
      releases: [],
    };
    const fullManifestHash = manifestHash(manifest);
    group.releases.push({
      claudeCode: manifest.claudeCode,
      result: manifest.result,
      createdAt: manifest.createdAt,
      evidenceHash: manifest.evidenceHash,
      suiteHash: manifest.suiteHash,
      manifestHash: fullManifestHash,
      manifest: `manifests/${fullManifestHash}.json`,
    });
    groups.set(key, group);
  }

  const components = [...groups.values()]
    .map((group) => ({
      ...group,
      releases: [...group.releases].sort((a, b) => compareVersion(b.claudeCode, a.claudeCode) || a.manifestHash.localeCompare(b.manifestHash)),
    }))
    .sort((a, b) =>
      a.component.localeCompare(b.component) ||
      (a.componentVersion ?? '').localeCompare(b.componentVersion ?? '') ||
      a.platform.localeCompare(b.platform)
    );

  return StaticRegistryIndexSchema.parse({
    schemaVersion: 1,
    registrySchemaVersion: 1,
    name: registry.name,
    generatedAt: registry.generatedAt,
    manifestCount: registry.manifests.length,
    registry: 'registry.json',
    checksumFile: 'SHA256SUMS',
    baseUrl,
    components,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function href(index: StaticRegistryIndex, relative: string): string {
  if (!index.baseUrl) return relative;
  return `${index.baseUrl}/${relative}`;
}

export function renderStaticRegistryHtml(indexValue: StaticRegistryIndex): string {
  const index = StaticRegistryIndexSchema.parse(indexValue);
  const rows = index.components.flatMap((component) => component.releases.map((release) => {
    const label = component.componentVersion ? `${component.component}@${component.componentVersion}` : component.component;
    return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(component.platform)}</td><td>${escapeHtml(release.claudeCode)}</td><td class="${release.result}">${escapeHtml(release.result)}</td><td><a href="${escapeHtml(href(index, release.manifest))}"><code>${escapeHtml(release.evidenceHash.slice(0, 12))}</code></a></td></tr>`;
  })).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(index.name)} compatibility registry</title>
<style>
:root{font-family:ui-sans-serif,system-ui,sans-serif;color-scheme:light dark}body{max-width:1100px;margin:3rem auto;padding:0 1rem;line-height:1.5}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.6rem;border-bottom:1px solid #8886}code{font-family:ui-monospace,monospace}.pass{font-weight:700}.fail{font-weight:700}.meta{opacity:.75}a{color:inherit}
</style>
</head>
<body>
<h1>${escapeHtml(index.name)}</h1>
<p class="meta">Static Claude Code Canary compatibility registry · ${index.manifestCount} manifest(s) · generated ${escapeHtml(index.generatedAt)}</p>
<p><a href="${escapeHtml(href(index, index.registry))}">registry.json</a> · <a href="${escapeHtml(href(index, 'index.json'))}">index.json</a> · <a href="${escapeHtml(href(index, index.checksumFile))}">SHA256SUMS</a></p>
<table>
<thead><tr><th>Component</th><th>Platform</th><th>Claude Code</th><th>Result</th><th>Evidence</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>
`;
}

async function ensureOutputDirectory(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const marker = path.join(outputDir, '.claude-canary-registry');
  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch {
    entries = [];
  }
  if (entries.length > 0 && !entries.includes('.claude-canary-registry')) {
    throw new Error(`Registry output directory is not empty and is not Canary-owned: ${outputDir}`);
  }
  if (entries.includes('.claude-canary-registry')) {
    for (const name of ['registry.json', 'index.json', 'index.html', 'SHA256SUMS', '.nojekyll']) {
      await rm(path.join(outputDir, name), { force: true });
    }
    await rm(path.join(outputDir, 'manifests'), { recursive: true, force: true });
  }
  await writeFile(marker, 'claude-code-canary static registry\n', 'utf8');
  await mkdir(path.join(outputDir, 'manifests'), { recursive: true });
}

async function writePublishedFile(outputDir: string, relative: string, content: string, contents: Map<string, string>): Promise<void> {
  const absolute = path.join(outputDir, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  contents.set(relative.replace(/\\/g, '/'), content);
}

export async function publishCompatibilityRegistry(
  registryFile: string,
  outputDirValue: string,
  options: StaticRegistryPublishOptions = {},
): Promise<StaticRegistryPublishResult> {
  const registry = await loadCompatibilityRegistry(registryFile);
  const outputDir = path.resolve(outputDirValue);
  await ensureOutputDirectory(outputDir);
  const index = buildStaticRegistryIndex(registry, options);
  const contents = new Map<string, string>();

  await writePublishedFile(outputDir, 'registry.json', json(registry), contents);
  await writePublishedFile(outputDir, 'index.json', json(index), contents);

  const manifests = [...registry.manifests].sort((a, b) => manifestHash(a).localeCompare(manifestHash(b)));
  const seen = new Set<string>();
  for (const manifest of manifests) {
    const relative = manifestPath(manifest);
    if (seen.has(relative)) continue;
    seen.add(relative);
    await writePublishedFile(outputDir, relative, json(manifest), contents);
  }

  if (options.html !== false) {
    await writePublishedFile(outputDir, 'index.html', renderStaticRegistryHtml(index), contents);
  }
  await writePublishedFile(outputDir, '.nojekyll', '', contents);

  const checksumLines = [...contents.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relative, content]) => `${sha256Text(content)}  ${relative}`);
  const checksumContent = `${checksumLines.join('\n')}\n`;
  await writeFile(path.join(outputDir, 'SHA256SUMS'), checksumContent, 'utf8');

  const files = [...contents.keys(), 'SHA256SUMS'].sort();
  return {
    schemaVersion: 1,
    outputDir,
    registryPath: path.join(outputDir, 'registry.json'),
    indexPath: path.join(outputDir, 'index.json'),
    checksumPath: path.join(outputDir, 'SHA256SUMS'),
    htmlPath: options.html === false ? undefined : path.join(outputDir, 'index.html'),
    manifestCount: registry.manifests.length,
    componentCount: index.components.length,
    files,
  };
}

function help(): string {
  return `Usage: claude-canary registry publish <registry.json> [options]\n\n` +
    `Options:\n` +
    `  --output <dir>       Output directory (default: .canary/registry-site)\n` +
    `  --base-url <url>     Optional absolute public base URL for generated links\n` +
    `  --no-html            Omit the static HTML index\n` +
    `  --json               Print the publish result as JSON\n` +
    `  --help               Show this help\n`;
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runRegistryPublishCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help());
    return;
  }
  const registryFile = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (!registryFile) throw new Error('registry publish requires a registry JSON file.');
  const output = valueAfter(args, '--output') ?? '.canary/registry-site';
  const result = await publishCompatibilityRegistry(registryFile, output, {
    baseUrl: valueAfter(args, '--base-url'),
    html: !args.includes('--no-html'),
  });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(`Published ${result.manifestCount} compatibility manifest(s) across ${result.componentCount} component target(s) to ${result.outputDir}`);
}
