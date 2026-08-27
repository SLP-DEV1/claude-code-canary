import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Scenario } from './config.js';
import { findExecutable } from './doctor.js';
import { getRepoRoot, resolveCommit } from './git.js';
import { runScenario, type RunOptions } from './runner.js';
import type { RunResult } from './types.js';
import { CANARY_VERSION } from './version.js';

export interface ResultCacheIdentity {
  schemaVersion: 1;
  scenarioHash: string;
  gitCommit: string;
  executableSha256: string;
  canaryVersion: string;
  platform: string;
  arch: string;
  nodeMajor: string;
  featureFlagsHash: string;
}

export interface CachedRunEnvelope {
  schemaVersion: 1;
  key: string;
  identity: ResultCacheIdentity;
  createdAt: string;
  result: RunResult;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export async function buildResultCacheIdentity(options: {
  cwd: string;
  scenarioSource: string;
  executable: string;
  gitRef?: string;
  featureFlags?: unknown;
}): Promise<ResultCacheIdentity> {
  const cwd = path.resolve(options.cwd);
  const repoRoot = await getRepoRoot(cwd);
  const gitCommit = await resolveCommit(repoRoot, options.gitRef ?? 'HEAD');
  const executable = await findExecutable(options.executable, cwd);
  if (!executable) throw new Error(`Result reuse requires a resolvable executable so it can be fingerprinted: ${options.executable}`);
  const nodeMajor = process.versions.node.split('.')[0];
  return {
    schemaVersion: 1,
    scenarioHash: createHash('sha256').update(options.scenarioSource).digest('hex'),
    gitCommit,
    executableSha256: await sha256File(executable),
    canaryVersion: CANARY_VERSION,
    platform: process.platform,
    arch: process.arch,
    nodeMajor,
    featureFlagsHash: sha256Json(options.featureFlags ?? {}),
  };
}

export function resultCacheKey(identity: ResultCacheIdentity): string {
  return sha256Json(identity);
}

function cacheFile(cacheRoot: string, key: string): string {
  return path.join(cacheRoot, `${key}.json`);
}

export async function readCachedRun(cacheRoot: string, identity: ResultCacheIdentity): Promise<RunResult | undefined> {
  const key = resultCacheKey(identity);
  let raw: string;
  try { raw = await readFile(cacheFile(cacheRoot, key), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
  let envelope: CachedRunEnvelope;
  try { envelope = JSON.parse(raw) as CachedRunEnvelope; }
  catch { return undefined; }
  if (envelope.schemaVersion !== 1 || envelope.key !== key) return undefined;
  if (sha256Json(envelope.identity) !== sha256Json(identity)) return undefined;
  if (!envelope.result || envelope.result.schemaVersion !== 1 || envelope.result.gitCommit !== identity.gitCommit) return undefined;
  return { ...envelope.result, artifactPath: undefined };
}

export async function writeCachedRun(cacheRoot: string, identity: ResultCacheIdentity, result: RunResult): Promise<string> {
  const key = resultCacheKey(identity);
  await mkdir(cacheRoot, { recursive: true });
  const file = cacheFile(cacheRoot, key);
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  const envelope: CachedRunEnvelope = { schemaVersion: 1, key, identity, createdAt: new Date().toISOString(), result: { ...result, artifactPath: undefined } };
  await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
  return file;
}

export async function runScenarioWithCache(
  scenario: Scenario,
  scenarioPath: string,
  options: RunOptions & { cacheRoot?: string; featureFlags?: unknown } = {},
): Promise<{ result: RunResult; cacheHit: boolean; cacheKey: string }> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const source = await readFile(path.resolve(cwd, scenarioPath), 'utf8');
  const executable = options.executableOverride ?? scenario.claude.executable;
  const providerFlags = Object.fromEntries([
    'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE',
  ].map((key) => [key, process.env[key] ?? null]));
  const identity = await buildResultCacheIdentity({
    cwd,
    scenarioSource: source,
    executable,
    gitRef: options.gitRefOverride,
    featureFlags: { scenario: { model: scenario.claude.model, permissionMode: scenario.claude.permission_mode, args: scenario.claude.args, env: scenario.claude.env }, providerFlags, extra: options.featureFlags },
  });
  const cacheRoot = path.resolve(cwd, options.cacheRoot ?? '.canary/cache/results');
  const key = resultCacheKey(identity);
  const cached = await readCachedRun(cacheRoot, identity);
  if (cached) return { result: cached, cacheHit: true, cacheKey: key };
  const result = await runScenario(scenario, options);
  await writeCachedRun(cacheRoot, identity, result);
  return { result, cacheHit: false, cacheKey: key };
}
