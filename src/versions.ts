import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RELEASE_BASE = 'https://downloads.claude.ai/claude-code-releases';
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

interface ManifestPlatform {
  checksum: string;
  size?: number;
}

interface ReleaseManifest {
  version: string;
  buildDate?: string;
  platforms: Record<string, ManifestPlatform>;
}

export interface InstallVersionOptions {
  platform?: string;
  cacheRoot?: string;
  onStatus?: (message: string) => void;
}

export interface InstalledClaudeVersion {
  requested: string;
  version: string;
  platform: string;
  executablePath: string;
  manifestPath: string;
  checksum: string;
  bytes: number;
  cached: boolean;
}

function status(options: InstallVersionOptions, message: string): void {
  options.onStatus?.(message);
}

export function isExactVersion(value: string): boolean {
  return EXACT_VERSION.test(value);
}

function detectMusl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report?.getReport() as unknown as { header?: { glibcVersionRuntime?: string } };
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

export function platformId(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = detectMusl(),
): string {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported architecture: ${arch}. Claude Code Canary currently supports x64 and arm64.`);
  }

  if (platform === 'win32') return `win32-${arch}`;
  if (platform === 'darwin') return `darwin-${arch}`;
  if (platform === 'linux') return `linux-${arch}${musl ? '-musl' : ''}`;
  throw new Error(`Unsupported platform: ${platform}`);
}

export function defaultVersionCacheRoot(): string {
  if (process.env.CC_CANARY_CACHE_DIR) return path.resolve(process.env.CC_CANARY_CACHE_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? homedir(), 'claude-code-canary', 'cache');
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'), 'claude-code-canary');
}

function executableName(platform: string): string {
  return platform.startsWith('win32-') ? 'claude.exe' : 'claude';
}

function validateResolvedVersion(value: string, source: string): string {
  const version = value.trim();
  if (!isExactVersion(version)) throw new Error(`Invalid Claude Code version returned for ${source}: ${JSON.stringify(version)}`);
  return version;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  return response.text();
}

export async function resolveClaudeVersion(spec: string): Promise<string> {
  if (isExactVersion(spec)) return spec;
  if (spec !== 'latest' && spec !== 'stable') {
    throw new Error(`Version must be x.y.z, latest, or stable; received ${JSON.stringify(spec)}`);
  }
  return validateResolvedVersion(await fetchText(`${RELEASE_BASE}/${spec}`), spec);
}

function parseManifest(raw: string, expectedVersion: string): ReleaseManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Release ${expectedVersion} returned invalid manifest JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Release ${expectedVersion} manifest is not an object`);
  const record = value as Record<string, unknown>;
  if (record.version !== expectedVersion) throw new Error(`Manifest version mismatch: expected ${expectedVersion}, got ${String(record.version)}`);
  if (typeof record.platforms !== 'object' || record.platforms === null || Array.isArray(record.platforms)) throw new Error(`Release ${expectedVersion} manifest has no platforms map`);

  const platforms: Record<string, ManifestPlatform> = {};
  for (const [id, entry] of Object.entries(record.platforms as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const platform = entry as Record<string, unknown>;
    if (typeof platform.checksum !== 'string' || !/^[a-fA-F0-9]{64}$/.test(platform.checksum)) continue;
    platforms[id] = {
      checksum: platform.checksum.toLowerCase(),
      size: typeof platform.size === 'number' && Number.isFinite(platform.size) ? platform.size : undefined,
    };
  }
  return { version: expectedVersion, buildDate: typeof record.buildDate === 'string' ? record.buildDate : undefined, platforms };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(file: string): Promise<{ checksum: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { checksum: hash.digest('hex'), bytes };
}

async function downloadBinary(url: string, destination: string): Promise<{ checksum: string; bytes: number }> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} while downloading ${url}`);

  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as never),
    meter,
    createWriteStream(destination, { mode: 0o755 }),
  );
  return { checksum: hash.digest('hex'), bytes };
}

export async function installClaudeVersion(
  spec: string,
  options: InstallVersionOptions = {},
): Promise<InstalledClaudeVersion> {
  const version = await resolveClaudeVersion(spec);
  const platform = options.platform ?? platformId();
  const cacheRoot = options.cacheRoot ?? defaultVersionCacheRoot();
  const versionDir = path.join(cacheRoot, 'versions', version, platform);
  const executablePath = path.join(versionDir, executableName(platform));
  const manifestPath = path.join(versionDir, 'manifest.json');

  status(options, `Resolving Claude Code ${version} (${platform})...`);
  const manifestRaw = await fetchText(`${RELEASE_BASE}/${version}/manifest.json`);
  const manifest = parseManifest(manifestRaw, version);
  const expected = manifest.platforms[platform];
  if (!expected) {
    const available = Object.keys(manifest.platforms).sort().join(', ');
    throw new Error(`Claude Code ${version} has no ${platform} binary. Available platforms: ${available}`);
  }

  await mkdir(versionDir, { recursive: true });
  await writeFile(manifestPath, `${manifestRaw.trim()}\n`, 'utf8');

  if (await fileExists(executablePath)) {
    const current = await hashFile(executablePath);
    const sizeMatches = expected.size === undefined || expected.size === current.bytes;
    if (current.checksum === expected.checksum && sizeMatches) {
      status(options, `Using cached Claude Code ${version} (${platform}).`);
      return {
        requested: spec,
        version,
        platform,
        executablePath,
        manifestPath,
        checksum: current.checksum,
        bytes: current.bytes,
        cached: true,
      };
    }
    status(options, `Cached Claude Code ${version} failed integrity check; replacing it.`);
    await rm(executablePath, { force: true });
  }

  const binary = executableName(platform);
  const url = `${RELEASE_BASE}/${version}/${platform}/${binary}`;
  const temporary = `${executablePath}.tmp-${process.pid}-${Date.now()}`;
  status(options, `Downloading Claude Code ${version} (${platform})...`);

  try {
    const downloaded = await downloadBinary(url, temporary);
    if (downloaded.checksum !== expected.checksum) {
      throw new Error(`SHA256 mismatch for Claude Code ${version} ${platform}: expected ${expected.checksum}, got ${downloaded.checksum}`);
    }
    if (expected.size !== undefined && downloaded.bytes !== expected.size) {
      throw new Error(`Size mismatch for Claude Code ${version} ${platform}: expected ${expected.size}, got ${downloaded.bytes}`);
    }
    if (process.platform !== 'win32') await chmod(temporary, 0o755);
    await rename(temporary, executablePath);
    status(options, `Cached Claude Code ${version} at ${executablePath}`);
    return {
      requested: spec,
      version,
      platform,
      executablePath,
      manifestPath,
      checksum: downloaded.checksum,
      bytes: downloaded.bytes,
      cached: false,
    };
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function cachedClaudePath(
  version: string,
  options: Pick<InstallVersionOptions, 'platform' | 'cacheRoot'> = {},
): Promise<string> {
  if (!isExactVersion(version)) throw new Error('Cached path lookup requires an exact x.y.z version.');
  const platform = options.platform ?? platformId();
  const cacheRoot = options.cacheRoot ?? defaultVersionCacheRoot();
  const executablePath = path.join(cacheRoot, 'versions', version, platform, executableName(platform));
  if (!(await fileExists(executablePath))) throw new Error(`Claude Code ${version} (${platform}) is not cached. Run: cc-canary versions install ${version}`);
  return executablePath;
}

function compareVersionsDesc(a: string, b: string): number {
  const aa = a.split('.').map(Number);
  const bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (aa[i] !== bb[i]) return (bb[i] ?? 0) - (aa[i] ?? 0);
  }
  return 0;
}

export async function listCachedClaudeVersions(
  options: Pick<InstallVersionOptions, 'platform' | 'cacheRoot'> = {},
): Promise<string[]> {
  const platform = options.platform ?? platformId();
  const cacheRoot = options.cacheRoot ?? defaultVersionCacheRoot();
  const root = path.join(cacheRoot, 'versions');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const versions: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isExactVersion(entry.name)) continue;
    const executablePath = path.join(root, entry.name, platform, executableName(platform));
    if (await fileExists(executablePath)) versions.push(entry.name);
  }
  return versions.sort(compareVersionsDesc);
}

export async function readCachedManifest(version: string, options: Pick<InstallVersionOptions, 'platform' | 'cacheRoot'> = {}): Promise<string> {
  const platform = options.platform ?? platformId();
  const cacheRoot = options.cacheRoot ?? defaultVersionCacheRoot();
  return readFile(path.join(cacheRoot, 'versions', version, platform, 'manifest.json'), 'utf8');
}
