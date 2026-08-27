import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { bisectReleases } from './bisect.js';
import { loadScenario } from './config.js';
import { compareExactVersions, fetchPublishedClaudeVersions, publishedVersionsBetween } from './release-catalog.js';
import { runSuite, type SuiteRunResult } from './suite.js';
import { installClaudeVersion } from './versions.js';

const WatchStateSchema = z.object({
  version: z.literal(1),
  lastObserved: z.string().regex(/^\d+\.\d+\.\d+$/),
  lastKnownGood: z.string().regex(/^\d+\.\d+\.\d+$/),
  updatedAt: z.string().min(1),
  lastResult: z.enum(['initialized', 'compatible', 'regression']).optional(),
}).strict();

export type WatchState = z.infer<typeof WatchStateSchema>;
export type WatchStatus = 'initialized' | 'no-change' | 'new-release' | 'compatible' | 'regression';

export interface WatchOptions {
  cwd?: string;
  suitePath: string;
  statePath?: string;
  good?: string;
  platform?: string;
  checkOnly?: boolean;
  tag?: string;
  shard?: string;
  concurrency?: number;
  onStatus?: (message: string) => void;
  writeArtifacts?: boolean;
}

export interface WatchResult {
  schemaVersion: 1;
  status: WatchStatus;
  createdAt: string;
  previousObserved?: string;
  previousKnownGood?: string;
  latest: string;
  unseen: string[];
  candidate?: string;
  firstBadRelease?: string;
  firstFailingScenario?: string;
  suite?: SuiteRunResult;
  statePath: string;
  jsonArtifactPath?: string;
  markdownArtifactPath?: string;
}

async function readState(file: string): Promise<WatchState | undefined> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = WatchStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw new Error(`Could not read Canary watch state ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveState(file: string, state: WatchState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function formatWatchMarkdown(result: WatchResult): string {
  const lines = [
    '# Claude Canary release watch',
    '',
    `**Status:** ${result.status}`,
    `**Latest published:** \`${result.latest}\``,
  ];
  if (result.previousKnownGood) lines.push(`**Previous known-good:** \`${result.previousKnownGood}\``);
  if (result.candidate) lines.push(`**Candidate:** \`${result.candidate}\``);
  if (result.firstBadRelease) lines.push(`**First bad release:** \`${result.firstBadRelease}\``);
  if (result.firstFailingScenario) lines.push(`**First failing scenario:** \`${result.firstFailingScenario}\``);
  if (result.unseen.length) lines.push(`**New releases observed:** ${result.unseen.map((value) => `\`${value}\``).join(', ')}`);
  if (result.suite) {
    lines.push('', '## Suite', '', `Passed ${result.suite.passedCount}/${result.suite.total} scenarios.`);
    for (const scenario of result.suite.scenarios.filter((item) => !item.passed)) {
      lines.push(`- FAIL \`${scenario.path}\`${scenario.fingerprint ? ` — \`${scenario.fingerprint.id}\`` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function writeWatchArtifacts(cwd: string, result: WatchResult): Promise<void> {
  const outputDir = path.join(cwd, '.canary', 'results');
  await mkdir(outputDir, { recursive: true });
  const stamp = result.createdAt.replace(/[:.]/g, '-');
  result.jsonArtifactPath = path.join(outputDir, `release-watch-${stamp}.json`);
  result.markdownArtifactPath = path.join(outputDir, `release-watch-${stamp}.md`);
  await writeFile(result.jsonArtifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(result.markdownArtifactPath, formatWatchMarkdown(result), 'utf8');
}

export async function watchClaudeCodeReleases(options: WatchOptions): Promise<WatchResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const statePath = path.resolve(cwd, options.statePath ?? '.canary/watch-state.json');
  const published = await fetchPublishedClaudeVersions();
  if (!published.length) throw new Error('Claude Code release catalog contains no exact stable releases.');
  const latest = published[published.length - 1];
  let state = await readState(statePath);
  const createdAt = new Date().toISOString();

  if (!state) {
    if (options.good) {
      if (!published.includes(options.good)) throw new Error(`Initial known-good release ${options.good} is not published.`);
      state = { version: 1, lastObserved: options.good, lastKnownGood: options.good, updatedAt: createdAt, lastResult: 'initialized' };
    } else {
      const result: WatchResult = {
        schemaVersion: 1,
        status: 'initialized',
        createdAt,
        latest,
        unseen: [],
        statePath,
      };
      if (!options.checkOnly) await saveState(statePath, { version: 1, lastObserved: latest, lastKnownGood: latest, updatedAt: createdAt, lastResult: 'initialized' });
      if (options.writeArtifacts !== false) await writeWatchArtifacts(cwd, result);
      return result;
    }
  }

  const unseen = published.filter((version) => compareExactVersions(version, state!.lastObserved) > 0);
  const base: WatchResult = {
    schemaVersion: 1,
    status: unseen.length ? 'new-release' : 'no-change',
    createdAt,
    previousObserved: state.lastObserved,
    previousKnownGood: state.lastKnownGood,
    latest,
    unseen,
    candidate: unseen.length ? unseen[unseen.length - 1] : undefined,
    statePath,
  };

  if (!unseen.length || options.checkOnly) {
    if (options.writeArtifacts !== false) await writeWatchArtifacts(cwd, base);
    return base;
  }

  const candidate = unseen[unseen.length - 1];
  options.onStatus?.(`Testing new Claude Code release ${candidate}...`);
  const installed = await installClaudeVersion(candidate, { platform: options.platform, onStatus: options.onStatus });
  const suite = await runSuite(options.suitePath, {
    cwd,
    tag: options.tag,
    shard: options.shard,
    concurrency: options.concurrency,
    executableOverride: installed.executablePath,
    artifactLabel: `watch-${candidate}`,
  });
  base.suite = suite;

  if (suite.passed) {
    base.status = 'compatible';
    await saveState(statePath, {
      version: 1,
      lastObserved: candidate,
      lastKnownGood: candidate,
      updatedAt: createdAt,
      lastResult: 'compatible',
    });
  } else {
    base.status = 'regression';
    const firstFailure = suite.scenarios.find((item) => !item.passed && item.result);
    if (firstFailure && compareExactVersions(state.lastKnownGood, candidate) < 0) {
      base.firstFailingScenario = firstFailure.path;
      const scenario = await loadScenario(path.resolve(cwd, firstFailure.path));
      const range = publishedVersionsBetween(published, state.lastKnownGood, candidate);
      if (range.length >= 2) {
        const bisect = await bisectReleases(scenario, range, {
          cwd,
          platform: options.platform,
          onStatus: options.onStatus,
        });
        base.firstBadRelease = bisect.firstBadVersion;
      }
    }
    await saveState(statePath, {
      version: 1,
      lastObserved: candidate,
      lastKnownGood: state.lastKnownGood,
      updatedAt: createdAt,
      lastResult: 'regression',
    });
  }

  if (options.writeArtifacts !== false) await writeWatchArtifacts(cwd, base);
  return base;
}

export { formatWatchMarkdown, readState as readWatchState };
