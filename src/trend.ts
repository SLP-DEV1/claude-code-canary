import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fingerprintRun } from './fingerprint.js';
import type { RunResult } from './types.js';

export interface TrendPoint {
  release?: string;
  scenario: string;
  createdAt: string;
  passed: boolean;
  totalTokens: number;
  toolCalls: number;
  durationMs: number;
  fingerprint?: string;
}

export interface TrendSummary {
  schemaVersion: 1;
  createdAt: string;
  points: number;
  passRate: number;
  totalTokens: { median: number; p95: number };
  toolCalls: { median: number; p95: number };
  durationMs: { median: number; p95: number };
  repeatedFingerprints: Array<{ id: string; count: number }>;
  releases: Array<{ release: string; runs: number; passRate: number }>;
  timeline: TrendPoint[];
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function releaseFromExecutable(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  const match = /(?:^|\/)(\d+\.\d+\.\d+)(?:\/|$)/.exec(normalized);
  return match?.[1];
}

function isRunResult(value: unknown): value is RunResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<RunResult>;
  return candidate.schemaVersion === 1
    && typeof candidate.scenario === 'string'
    && typeof candidate.executable === 'string'
    && typeof candidate.passed === 'boolean'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.durationMs === 'number'
    && Boolean(candidate.metrics && typeof candidate.metrics.totalTokens === 'number' && typeof candidate.metrics.toolCalls === 'number');
}

export async function loadTrendPoints(directory: string): Promise<TrendPoint[]> {
  const root = path.resolve(directory);
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
  const points: TrendPoint[] = [];
  for (const name of names) {
    let value: unknown;
    try {
      const raw = await readFile(path.join(root, name), 'utf8');
      if (raw.length > 10 * 1024 * 1024) continue;
      value = JSON.parse(raw);
    } catch { continue; }
    const candidates: RunResult[] = [];
    if (isRunResult(value)) candidates.push(value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.scenarios)) {
        for (const item of record.scenarios) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const run = (item as Record<string, unknown>).result;
            if (isRunResult(run)) candidates.push(run);
          }
        }
      }
      if (Array.isArray(record.results)) for (const run of record.results) if (isRunResult(run)) candidates.push(run);
    }
    for (const run of candidates) {
      points.push({
        release: releaseFromExecutable(run.executable),
        scenario: run.scenario,
        createdAt: run.createdAt,
        passed: run.passed,
        totalTokens: run.metrics.totalTokens,
        toolCalls: run.metrics.toolCalls,
        durationMs: run.durationMs,
        fingerprint: run.passed ? undefined : fingerprintRun(run).id,
      });
    }
  }
  return points.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.scenario.localeCompare(b.scenario));
}

export function summarizeTrends(points: TrendPoint[]): TrendSummary {
  const fingerprints = new Map<string, number>();
  const releases = new Map<string, { runs: number; passes: number }>();
  for (const point of points) {
    if (point.fingerprint) fingerprints.set(point.fingerprint, (fingerprints.get(point.fingerprint) ?? 0) + 1);
    if (point.release) {
      const item = releases.get(point.release) ?? { runs: 0, passes: 0 };
      item.runs += 1;
      if (point.passed) item.passes += 1;
      releases.set(point.release, item);
    }
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    points: points.length,
    passRate: points.length ? points.filter((point) => point.passed).length / points.length : 0,
    totalTokens: { median: quantile(points.map((point) => point.totalTokens), 0.5), p95: quantile(points.map((point) => point.totalTokens), 0.95) },
    toolCalls: { median: quantile(points.map((point) => point.toolCalls), 0.5), p95: quantile(points.map((point) => point.toolCalls), 0.95) },
    durationMs: { median: quantile(points.map((point) => point.durationMs), 0.5), p95: quantile(points.map((point) => point.durationMs), 0.95) },
    repeatedFingerprints: [...fingerprints.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    releases: [...releases.entries()].map(([release, value]) => ({ release, runs: value.runs, passRate: value.passes / value.runs })).sort((a, b) => a.release.localeCompare(b.release)),
    timeline: points,
  };
}

export function formatTrendMarkdown(summary: TrendSummary): string {
  const lines = [
    '# Claude Canary local trends', '',
    `**Runs:** ${summary.points}`,
    `**Pass rate:** ${(summary.passRate * 100).toFixed(1)}%`, '',
    '| Metric | Median | p95 |', '| --- | ---: | ---: |',
    `| Total tokens | ${summary.totalTokens.median} | ${summary.totalTokens.p95} |`,
    `| Tool calls | ${summary.toolCalls.median} | ${summary.toolCalls.p95} |`,
    `| Duration ms | ${summary.durationMs.median} | ${summary.durationMs.p95} |`,
  ];
  if (summary.releases.length) {
    lines.push('', '## Releases', '', '| Release | Runs | Pass rate |', '| --- | ---: | ---: |');
    for (const release of summary.releases) lines.push(`| ${release.release} | ${release.runs} | ${(release.passRate * 100).toFixed(1)}% |`);
  }
  if (summary.repeatedFingerprints.length) {
    lines.push('', '## Repeated failure fingerprints', '');
    for (const item of summary.repeatedFingerprints) lines.push(`- \`${item.id}\` — ${item.count} occurrences`);
  }
  return `${lines.join('\n')}\n`;
}
