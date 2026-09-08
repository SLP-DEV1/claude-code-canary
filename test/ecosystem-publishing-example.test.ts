import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const workflowFile = new URL('../examples/github-actions/publish-signed-manifest.yml', import.meta.url);

describe('signed manifest GitHub Actions example', () => {
  it('parses and keeps signing secrets out of command arguments', async () => {
    const raw = await readFile(workflowFile, 'utf8');
    const workflow = YAML.parse(raw) as Record<string, any>;
    expect(workflow.name).toBe('Publish signed Canary manifest');
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(workflow.permissions).toEqual({ contents: 'write' });
    expect(workflow.env.CANARY_MANIFEST_SIGNING_KEY).toContain('secrets.CANARY_MANIFEST_SIGNING_KEY');
    expect(workflow.env.CANARY_MANIFEST_PUBLIC_KEY).toContain('vars.CANARY_MANIFEST_PUBLIC_KEY');
    expect(raw).toContain('--private-key-env CANARY_MANIFEST_SIGNING_KEY');
    expect(raw).toContain('--public-key-env CANARY_MANIFEST_PUBLIC_KEY');
    expect(raw).not.toContain('--private-key "${{');
    expect(raw).not.toContain('--public-key "${{');
  });

  it('pins third-party actions and verifies before release upload', async () => {
    const raw = await readFile(workflowFile, 'utf8');
    expect(raw).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(raw).toContain('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38');
    const verifyIndex = raw.indexOf('compat verify');
    const uploadIndex = raw.indexOf('gh release upload');
    expect(verifyIndex).toBeGreaterThan(0);
    expect(uploadIndex).toBeGreaterThan(verifyIndex);
    expect(raw).toContain('gh release view');
  });
});
