import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  CompatibilityManifestSchema,
  loadCompatibilityManifest,
  sha256Canonical,
  type CompatibilityManifest,
} from './compatibility.js';

const HttpUrlSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Expected an absolute http(s) URL.');

export const CompatibilityBadgeMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  component: z.string().min(1),
  componentVersion: z.string().min(1).optional(),
  claudeCode: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.string().min(1),
  result: z.enum(['pass', 'fail', 'unsupported']),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  suiteHash: z.string().regex(/^[0-9a-f]{64}$/),
  badge: z.string().min(1),
  manifest: z.string().min(1),
  evidenceUrl: HttpUrlSchema.optional(),
}).strict();

export type CompatibilityBadgeMetadata = z.infer<typeof CompatibilityBadgeMetadataSchema>;

export interface CompatibilityBadgeOptions {
  badgePath?: string;
  manifestPath?: string;
  evidenceUrl?: string;
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function resultColor(result: CompatibilityManifest['result']): string {
  if (result === 'pass') return '#2da44e';
  if (result === 'fail') return '#cf222e';
  return '#6e7781';
}

function segmentWidth(text: string): number {
  return Math.max(54, 14 + text.length * 7);
}

export function renderCompatibilityBadgeSvg(manifestValue: CompatibilityManifest): string {
  const manifest = CompatibilityManifestSchema.parse(manifestValue);
  const left = `Claude Code ${manifest.claudeCode}`;
  const right = manifest.result;
  const leftWidth = segmentWidth(left);
  const rightWidth = segmentWidth(right);
  const width = leftWidth + rightWidth;
  const title = `${manifest.component}${manifest.componentVersion ? `@${manifest.componentVersion}` : ''} on ${manifest.platform}: ${manifest.result}; evidence ${manifest.evidenceHash}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${xml(left)}: ${xml(right)}" width="${width}" height="20" viewBox="0 0 ${width} 20">\n` +
    `<title>${xml(title)}</title>\n` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-opacity=".08"/></linearGradient>\n` +
    `<clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath>\n` +
    `<g clip-path="url(#r)"><rect width="${leftWidth}" height="20" fill="#555"/><rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${resultColor(manifest.result)}"/><rect width="${width}" height="20" fill="url(#s)"/></g>\n` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="${leftWidth / 2}" y="15">${xml(left)}</text><text x="${leftWidth + rightWidth / 2}" y="15">${xml(right)}</text></g>\n` +
    `</svg>\n`;
}

export function buildCompatibilityBadgeMetadata(
  manifestValue: CompatibilityManifest,
  options: CompatibilityBadgeOptions = {},
): CompatibilityBadgeMetadata {
  const manifest = CompatibilityManifestSchema.parse(manifestValue);
  return CompatibilityBadgeMetadataSchema.parse({
    schemaVersion: 1,
    component: manifest.component,
    componentVersion: manifest.componentVersion,
    claudeCode: manifest.claudeCode,
    platform: manifest.platform,
    result: manifest.result,
    manifestHash: sha256Canonical(manifest),
    evidenceHash: manifest.evidenceHash,
    suiteHash: manifest.suiteHash,
    badge: options.badgePath ?? 'badge.svg',
    manifest: options.manifestPath ?? 'manifest.json',
    evidenceUrl: options.evidenceUrl,
  });
}

function markdownTarget(relative: string, baseUrl?: string): string {
  if (!baseUrl) return relative;
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('--base-url must be an absolute http(s) URL without credentials, query, or fragment.');
  }
  const base = parsed.toString().replace(/\/$/, '');
  return `${base}/${relative}`;
}

export async function publishCompatibilityBadge(
  manifestFile: string,
  outputDirValue: string,
  options: { baseUrl?: string; evidenceUrl?: string } = {},
): Promise<{ outputDir: string; badgePath: string; metadataPath: string; markdownPath: string; manifestPath: string }> {
  const manifest = await loadCompatibilityManifest(manifestFile);
  const outputDir = path.resolve(outputDirValue);
  await mkdir(outputDir, { recursive: true });
  const metadata = buildCompatibilityBadgeMetadata(manifest, { evidenceUrl: options.evidenceUrl });
  const badgePath = path.join(outputDir, 'badge.svg');
  const metadataPath = path.join(outputDir, 'badge.json');
  const markdownPath = path.join(outputDir, 'badge.md');
  const manifestPath = path.join(outputDir, 'manifest.json');
  await writeFile(badgePath, renderCompatibilityBadgeSvg(manifest), 'utf8');
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const image = markdownTarget('badge.svg', options.baseUrl);
  const target = options.evidenceUrl ?? markdownTarget('manifest.json', options.baseUrl);
  const alt = `${manifest.component} compatibility with Claude Code ${manifest.claudeCode}`.replace(/]/g, '\\]');
  await writeFile(markdownPath, `[![${alt}](${image})](${target})\n`, 'utf8');
  return { outputDir, badgePath, metadataPath, markdownPath, manifestPath };
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runCompatibilityBadgeCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: claude-canary compat badge <manifest.json> [--output <dir>] [--base-url <url>] [--evidence-url <url>] [--json]');
    return;
  }
  const file = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (!file) throw new Error('compat badge requires a compatibility manifest JSON file.');
  const output = valueAfter(args, '--output') ?? '.canary/compatibility-badge';
  const result = await publishCompatibilityBadge(file, output, {
    baseUrl: valueAfter(args, '--base-url'),
    evidenceUrl: valueAfter(args, '--evidence-url'),
  });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(`Evidence-backed compatibility badge -> ${result.badgePath}`);
}
