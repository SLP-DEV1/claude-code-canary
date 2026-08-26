import { isExactVersion } from './versions.js';

const CLAUDE_CODE_REGISTRY_URL = 'https://registry.npmjs.org/@anthropic-ai%2fclaude-code';

function versionParts(version: string): [number, number, number] {
  if (!isExactVersion(version)) throw new Error(`Expected an exact Claude Code version (x.y.z), got ${JSON.stringify(version)}`);
  const [major, minor, patch] = version.split('.').map(Number);
  return [major, minor, patch];
}

export function compareExactVersions(a: string, b: string): number {
  const aa = versionParts(a);
  const bb = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return 0;
}

export function publishedVersionsBetween(
  publishedVersions: Iterable<string>,
  good: string,
  bad: string,
): string[] {
  if (!isExactVersion(good) || !isExactVersion(bad)) {
    throw new Error('--good and --bad must be exact Claude Code versions such as 2.1.220.');
  }
  if (compareExactVersions(good, bad) >= 0) {
    throw new Error(`--good must be older than --bad; received ${good} .. ${bad}`);
  }

  const exact = [...new Set([...publishedVersions].filter(isExactVersion))].sort(compareExactVersions);
  if (!exact.includes(good)) throw new Error(`Known-good Claude Code ${good} is not present in the published release catalog.`);
  if (!exact.includes(bad)) throw new Error(`Known-bad Claude Code ${bad} is not present in the published release catalog.`);

  return exact.filter((version) => compareExactVersions(version, good) >= 0 && compareExactVersions(version, bad) <= 0);
}

export async function fetchPublishedClaudeVersions(): Promise<string[]> {
  const response = await fetch(CLAUDE_CODE_REGISTRY_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching Claude Code release catalog`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Claude Code npm release catalog returned invalid JSON.');
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Claude Code npm release catalog is not an object.');
  }
  const versions = (body as Record<string, unknown>).versions;
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions)) {
    throw new Error('Claude Code npm release catalog has no versions map.');
  }

  return Object.keys(versions as Record<string, unknown>)
    .filter(isExactVersion)
    .sort(compareExactVersions);
}

export async function fetchPublishedVersionsBetween(good: string, bad: string): Promise<string[]> {
  return publishedVersionsBetween(await fetchPublishedClaudeVersions(), good, bad);
}
