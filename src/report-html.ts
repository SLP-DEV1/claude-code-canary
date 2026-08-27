import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ResultArtifactSummary {
  file: string;
  kind: 'suite' | 'run' | 'watch' | 'flake' | 'other';
  title: string;
  passed?: boolean;
  status?: string;
  createdAt?: string;
  totalTokens?: number;
  toolCalls?: number;
  durationMs?: number;
  failures: string[];
  fingerprint?: string;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function summarizeArtifact(file: string, value: unknown): ResultArtifactSummary {
  const data = record(value) ?? {};
  const metrics = record(data.metrics);
  const failures = Array.isArray(data.failures) ? data.failures.filter((item): item is string => typeof item === 'string') : [];
  if (typeof data.suite === 'string' && Array.isArray(data.scenarios)) {
    const suiteFailures = data.scenarios.flatMap((entry) => {
      const item = record(entry);
      if (!item || item.passed === true) return [];
      if (typeof item.infrastructureError === 'string') return [item.infrastructureError];
      const result = record(item.result);
      return Array.isArray(result?.failures) ? result.failures.filter((failure): failure is string => typeof failure === 'string') : [];
    });
    return {
      file,
      kind: 'suite',
      title: data.suite,
      passed: data.passed === true,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      failures: suiteFailures,
    };
  }
  if (typeof data.status === 'string' && typeof data.latest === 'string') {
    return {
      file,
      kind: 'watch',
      title: `Release watch ${data.latest}`,
      status: data.status,
      passed: data.status === 'compatible' || data.status === 'no-change' || data.status === 'initialized',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      failures,
    };
  }
  if (typeof data.classification === 'string' && typeof data.passRate === 'number') {
    return {
      file,
      kind: 'flake',
      title: typeof data.scenario === 'string' ? data.scenario : file,
      status: `${data.classification} (${(data.passRate * 100).toFixed(1)}%)`,
      passed: data.classification !== 'flaky',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      failures,
    };
  }
  if (typeof data.scenario === 'string' && typeof data.passed === 'boolean') {
    return {
      file,
      kind: 'run',
      title: data.scenario,
      passed: data.passed,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      totalTokens: typeof metrics?.totalTokens === 'number' ? metrics.totalTokens : undefined,
      toolCalls: typeof metrics?.toolCalls === 'number' ? metrics.toolCalls : undefined,
      durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
      failures,
      fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : undefined,
    };
  }
  return { file, kind: 'other', title: file, failures };
}

export async function loadResultSummaries(directory: string): Promise<ResultArtifactSummary[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const summaries: ResultArtifactSummary[] = [];
  for (const name of names) {
    const file = path.join(directory, name);
    let value: unknown;
    try {
      const raw = await readFile(file, 'utf8');
      if (raw.length > 10 * 1024 * 1024) continue;
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    summaries.push(summarizeArtifact(name, value));
  }
  return summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.file.localeCompare(b.file));
}

export function renderStaticHtmlReport(summaries: ResultArtifactSummary[], title = 'Claude Code Canary Report'): string {
  const passed = summaries.filter((item) => item.passed === true).length;
  const failed = summaries.filter((item) => item.passed === false).length;
  const rows = summaries.map((item) => {
    const result = item.passed === undefined ? (item.status ?? 'info') : item.passed ? 'PASS' : 'FAIL';
    const metrics = [
      item.totalTokens === undefined ? '' : `${item.totalTokens} tokens`,
      item.toolCalls === undefined ? '' : `${item.toolCalls} tools`,
      item.durationMs === undefined ? '' : `${item.durationMs} ms`,
    ].filter(Boolean).join(' · ');
    const failures = item.failures.slice(0, 5).map((failure) => `<li>${escapeHtml(failure)}</li>`).join('');
    return `<tr><td>${escapeHtml(item.kind)}</td><td><strong>${escapeHtml(item.title)}</strong><div class="muted">${escapeHtml(item.file)}</div></td><td class="${item.passed === false ? 'fail' : item.passed === true ? 'pass' : ''}">${escapeHtml(result)}</td><td>${escapeHtml(metrics)}</td><td>${failures ? `<ul>${failures}</ul>` : ''}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;margin:2rem;line-height:1.45;color:#171717}h1{margin-bottom:.25rem}.summary{display:flex;gap:1rem;margin:1rem 0 2rem}.card{border:1px solid #ddd;border-radius:8px;padding:.8rem 1rem;min-width:8rem}.pass{color:#08752b;font-weight:700}.fail{color:#b42318;font-weight:700}.muted{color:#666;font-size:.85rem}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:.65rem;border-bottom:1px solid #e5e5e5}th{background:#f7f7f7}ul{margin:.2rem 0;padding-left:1.2rem}</style></head>
<body><h1>${escapeHtml(title)}</h1><div class="muted">Portable, privacy-minimized summary. Raw prompts, transcripts and environment values are not embedded.</div>
<div class="summary"><div class="card"><strong>${summaries.length}</strong><br>artifacts</div><div class="card"><strong class="pass">${passed}</strong><br>passing</div><div class="card"><strong class="fail">${failed}</strong><br>failing</div></div>
<table><thead><tr><th>Kind</th><th>Artifact</th><th>Result</th><th>Metrics</th><th>Failures</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export async function generateStaticHtmlReport(inputDirectory: string, outputDirectory: string, title?: string): Promise<string> {
  const input = path.resolve(inputDirectory);
  const output = path.resolve(outputDirectory);
  const summaries = await loadResultSummaries(input);
  await mkdir(output, { recursive: true });
  const reportPath = path.join(output, 'index.html');
  await writeFile(reportPath, renderStaticHtmlReport(summaries, title), 'utf8');
  return reportPath;
}
