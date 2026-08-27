import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCompatibilityGraph,
  createBundleAttestation,
  createCanaryLock,
  createCompatibilityManifest,
  explainCompatibility,
  firstKnownBad,
  mergeCompatibilityRegistries,
  newestKnownGood,
  queryCompatibility,
  verifyBundleAttestation,
} from '../src/api.js';
import { fingerprintRun } from '../src/fingerprint.js';
import { evaluatePermissionPolicy } from '../src/policy.js';
import { renderStaticHtmlReport } from '../src/report-html.js';
import { suiteToJUnit } from '../src/junit.js';
import { suiteToSarif } from '../src/sarif.js';
import { explainSuiteSelection, parseSuite, type SuiteRunResult } from '../src/suite.js';
import { summarizeTrends } from '../src/trend.js';
import type { RunResult } from '../src/types.js';

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    scenario: 'demo',
    executable: '/cache/2.1.100/claude',
    passed: false,
    failures: ['Expected file after abcdef1234567890, 100 tokens'],
    claudeExitCode: 0,
    claudeTimedOut: false,
    durationMs: 100,
    changedFiles: ['src/a.ts'],
    setup: [],
    verification: [],
    metrics: {
      toolCalls: 1,
      toolNames: ['Read'],
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 15,
      hookEvents: [],
      hookEventSequence: [],
      permissionPrompts: 0,
      permissionDenied: 0,
      permissionRequests: [],
      parseErrors: 0,
    },
    createdAt: '2026-08-28T00:00:00.000Z',
    gitCommit: 'a'.repeat(40),
    ...overrides,
  };
}

describe('v2 compatibility platform', () => {
  it('fingerprints equivalent failures deterministically', () => {
    const first = fingerprintRun(run());
    const second = fingerprintRun(run({ failures: ['Expected file after ffffffffffffffffffffffffffffffffffffffff, 200 tokens'] }));
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('builds portable manifests, lockfiles, queries and a compatibility graph', () => {
    const good = createCompatibilityManifest({
      claudeCode: '2.1.100', component: 'plugin-a', componentVersion: '1.0.0', platform: 'linux-x64',
      suiteDefinition: { version: 1, name: 'release' }, result: 'pass', evidence: { passed: true },
    });
    const bad = createCompatibilityManifest({
      claudeCode: '2.1.101', component: 'plugin-a', componentVersion: '1.0.0', platform: 'linux-x64',
      suiteDefinition: { version: 1, name: 'release' }, result: 'fail', evidence: { passed: false }, failureFingerprints: ['1'.repeat(16)],
    });
    const registry = mergeCompatibilityRegistries('workspace', [
      { schemaVersion: 1, name: 'one', generatedAt: good.createdAt, manifests: [good] },
      { schemaVersion: 1, name: 'two', generatedAt: bad.createdAt, manifests: [bad] },
    ]);

    expect(queryCompatibility(registry, { component: 'plugin-a' })).toHaveLength(2);
    expect(newestKnownGood(registry, { component: 'plugin-a' })?.claudeCode).toBe('2.1.100');
    expect(firstKnownBad(registry, { component: 'plugin-a' })?.claudeCode).toBe('2.1.101');
    expect(explainCompatibility(registry, { component: 'plugin-a' }).status).toBe('regression-known');
    expect(buildCompatibilityGraph(registry).nodes.some((node) => node.kind === 'canary')).toBe(true);
    expect(createCanaryLock([good]).claudeCode).toBe('2.1.100');
  });

  it('evaluates permission policies without persisting tool inputs', () => {
    const stdout = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git push origin main' } }] } });
    const baseMetrics = run().metrics;
    const denied = evaluatePermissionPolicy(stdout, baseMetrics, { never_auto_allow: [], require_prompt: ['Bash(git push *)'], deny_use: [], allow_only: [] });
    expect(denied.passed).toBe(false);
    expect(JSON.stringify(denied.coverage)).not.toContain('git push origin main');

    const prompted = evaluatePermissionPolicy(stdout, { ...baseMetrics, permissionRequests: [{ toolName: 'Bash', toolUseId: 't1' }] }, { never_auto_allow: [], require_prompt: ['Bash(git push *)'], deny_use: [], allow_only: [] });
    expect(prompted.passed).toBe(true);
    expect(prompted.coverage.promptedTools).toEqual(['Bash']);
  });

  it('selects suites deterministically by tags and affected paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'canary-suite-'));
    try {
      await mkdir(path.join(root, '.canary'), { recursive: true });
      await writeFile(path.join(root, '.canary', 'auth.canary.yml'), 'version: 1\nname: auth\nprompt: test auth\ntags: [release]\naffects: [src/auth/**]\n', 'utf8');
      await writeFile(path.join(root, '.canary', 'docs.canary.yml'), 'version: 1\nname: docs\nprompt: test docs\ntags: [docs]\naffects: [docs/**]\n', 'utf8');
      const suite = parseSuite({ version: 1, name: 'release', include: ['.canary/*.canary.yml'] });
      const selection = await explainSuiteSelection(suite, { cwd: root, tag: 'release', changedPaths: ['src/auth/login.ts'] });
      expect(selection.selected.map((item) => item.path)).toEqual(['.canary/auth.canary.yml']);
      expect(selection.skipped.some((item) => item.path.endsWith('docs.canary.yml') && item.reason === 'tag')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits interoperable JUnit, SARIF and static HTML without source-line invention', () => {
    const failedRun = run();
    const suite: SuiteRunResult = {
      schemaVersion: 1,
      suite: 'release', suitePath: '.canary/release.suite.yml', createdAt: failedRun.createdAt,
      passed: false, total: 1, discoveredTotal: 1, passedCount: 0, failedCount: 1, infrastructureFailedCount: 0,
      cacheHitCount: 0, skippedBySelection: 0, skipped: [],
      scenarios: [{ path: '.canary/demo.canary.yml', passed: false, result: failedRun, fingerprint: fingerprintRun(failedRun) }],
      failureClusters: [],
    };
    expect(suiteToJUnit(suite)).toContain('<failure');
    const sarif = suiteToSarif(suite);
    expect(sarif.runs[0].results[0]).not.toHaveProperty('locations');
    expect(renderStaticHtmlReport([{ file: 'suite.json', kind: 'suite', title: 'release', passed: false, failures: ['failed'] }])).toContain('Portable, privacy-minimized summary');
  });

  it('summarizes local trends and verifies bundle integrity', async () => {
    const trends = summarizeTrends([
      { release: '2.1.100', scenario: 'a', createdAt: '2026-01-01T00:00:00Z', passed: true, totalTokens: 100, toolCalls: 2, durationMs: 10 },
      { release: '2.1.101', scenario: 'a', createdAt: '2026-01-02T00:00:00Z', passed: false, totalTokens: 200, toolCalls: 4, durationMs: 20, fingerprint: '1'.repeat(16) },
    ]);
    expect(trends.passRate).toBe(0.5);
    expect(trends.totalTokens.p95).toBe(200);

    const root = await mkdtemp(path.join(tmpdir(), 'canary-attest-'));
    try {
      await writeFile(path.join(root, 'evidence.json'), '{"ok":true}\n', 'utf8');
      const attestation = await createBundleAttestation(root);
      expect((await verifyBundleAttestation(root, attestation)).passed).toBe(true);
      await writeFile(path.join(root, 'evidence.json'), '{"ok":false}\n', 'utf8');
      expect((await verifyBundleAttestation(root, attestation)).passed).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps every published schema valid JSON', async () => {
    const dir = new URL('../schemas/', import.meta.url);
    for (const name of (await readdir(dir)).filter((file) => file.endsWith('.json'))) {
      const raw = await readFile(new URL(name, dir), 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});
