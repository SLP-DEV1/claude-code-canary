import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadResultSummaries, renderStaticHtmlReport } from '../src/report-html.js';

describe('static HTML report navigation', () => {
  it('captures suite progress counts for large-suite summaries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'canary-report-'));
    await writeFile(path.join(directory, 'suite.json'), JSON.stringify({
      schemaVersion: 1,
      suite: 'release-suite',
      createdAt: '2026-09-07T20:00:00.000Z',
      passed: false,
      total: 120,
      passedCount: 117,
      failedCount: 3,
      skippedBySelection: 8,
      scenarios: [
        { path: '.canary/pass.canary.yml', passed: true, result: { failures: [] } },
        { path: '.canary/fail.canary.yml', passed: false, result: { failures: ['expected marker missing'] } },
      ],
    }), 'utf8');

    const [summary] = await loadResultSummaries(directory);
    expect(summary).toMatchObject({
      kind: 'suite',
      title: 'release-suite',
      passed: false,
      scenarioTotal: 120,
      scenarioPassed: 117,
      scenarioFailed: 3,
      scenarioSkipped: 8,
      failures: ['expected marker missing'],
    });
  });

  it('renders search, filters, sorting, pagination and failure navigation', () => {
    const html = renderStaticHtmlReport([
      {
        file: 'suite.json',
        kind: 'suite',
        title: 'release-suite',
        passed: false,
        createdAt: '2026-09-07T20:00:00.000Z',
        failures: ['regression marker missing'],
        scenarioTotal: 120,
        scenarioPassed: 117,
        scenarioFailed: 3,
      },
      {
        file: 'run.json',
        kind: 'run',
        title: 'smoke scenario',
        passed: true,
        createdAt: '2026-09-07T19:00:00.000Z',
        failures: [],
        totalTokens: 1200,
      },
    ], 'Large suite report');

    expect(html).toContain('id="search"');
    expect(html).toContain('id="statusFilter"');
    expect(html).toContain('id="kindFilter"');
    expect(html).toContain('id="sortOrder"');
    expect(html).toContain('id="pageSize"');
    expect(html).toContain('id="firstFailure"');
    expect(html).toContain('id="prevPage"');
    expect(html).toContain('data-state="fail"');
    expect(html).toContain('120 scenarios · 117 passed · 3 failed');
    expect(html).toContain('1 issue</summary>');
    expect(html).toContain("new URLSearchParams(location.search)");
  });

  it('escapes searchable report values instead of exposing HTML markup', () => {
    const html = renderStaticHtmlReport([{
      file: 'unsafe<file>.json',
      kind: 'run',
      title: '<script>alert(1)</script>',
      passed: false,
      failures: ['<img src=x onerror=alert(1)>'],
    }]);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders an empty report with usable controls and zero-result state', () => {
    const html = renderStaticHtmlReport([]);
    expect(html).toContain('<strong>0</strong><br>artifacts');
    expect(html).toContain('No artifacts match the current filters.');
    expect(html).toContain('All kinds');
  });
});
