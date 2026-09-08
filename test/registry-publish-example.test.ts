import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('static registry publishing GitHub Actions example', () => {
  it('is valid YAML with least-privilege Pages deployment and pinned external actions', async () => {
    const source = await readFile(new URL('../examples/github-actions/publish-registry-pages.yml', import.meta.url), 'utf8');
    const workflow = parse(source) as {
      on?: Record<string, unknown>;
      permissions?: Record<string, string>;
      concurrency?: { group?: string; ['cancel-in-progress']?: boolean };
      jobs?: Record<string, {
        environment?: { name?: string; url?: string };
        steps?: Array<{ name?: string; uses?: string; run?: string; id?: string; with?: Record<string, string> }>;
      }>;
    };

    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on).toHaveProperty('push');
    expect(workflow.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' });
    expect(workflow.concurrency?.group).toBe('claude-canary-compatibility-pages');
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(true);

    const job = workflow.jobs?.publish;
    expect(job?.environment?.name).toBe('github-pages');
    expect(job?.environment?.url).toContain('steps.deployment.outputs.page_url');
    const steps = job?.steps ?? [];
    const build = steps.find((step) => step.name === 'Build static compatibility registry');
    expect(build?.run).toContain('registry publish compatibility.registry.json');
    expect(build?.run).toContain('--output .canary/registry-site');
    expect(steps.find((step) => step.name === 'Upload Pages artifact')?.with?.path).toBe('.canary/registry-site');
    expect(steps.find((step) => step.name === 'Deploy GitHub Pages')?.id).toBe('deployment');

    const externalUses = steps.map((step) => step.uses).filter((value): value is string => Boolean(value));
    expect(externalUses).toHaveLength(5);
    expect(externalUses.every((value) => /@[0-9a-f]{40}$/.test(value))).toBe(true);
  });
});
