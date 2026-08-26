import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('Claude Canary GitHub Action', () => {
  it('exposes the expected composite action contract', async () => {
    const source = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
    const action = parse(source) as {
      name?: string;
      inputs?: Record<string, { required?: boolean; default?: string }>;
      runs?: { using?: string; steps?: Array<{ id?: string }> };
      outputs?: Record<string, unknown>;
    };

    expect(action.name).toBe('Claude Canary');
    expect(action.runs?.using).toBe('composite');
    expect(action.inputs?.scenario?.default).toBe('.canary/basic.canary.yml');
    expect(action.inputs?.from?.required).toBe(true);
    expect(action.inputs?.to?.default).toBe('latest');
    expect(action.inputs?.['upload-results']?.default).toBe('true');
    expect(action.runs?.steps?.some((step) => step.id === 'canary')).toBe(true);
    expect(action.outputs).toHaveProperty('results-path');
  });

  it('publishes the CLI as claude-canary', async () => {
    const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(source) as { bin?: Record<string, string> };

    expect(pkg.bin).toEqual({ 'claude-canary': './dist/index.js' });
  });
});
