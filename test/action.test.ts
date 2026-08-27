import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('Claude Canary GitHub Action', () => {
  it('exposes the v1 multi-mode composite action contract', async () => {
    const source = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
    const action = parse(source) as {
      name?: string;
      description?: string;
      branding?: { icon?: string; color?: string };
      inputs?: Record<string, { required?: boolean; default?: string }>;
      runs?: { using?: string; steps?: Array<{ id?: string; uses?: string }> };
      outputs?: Record<string, unknown>;
    };

    expect(action.name).toBe('Claude Code Canary');
    expect(action.description).toMatch(/regression-test/i);
    expect(action.branding).toEqual({ icon: 'activity', color: 'yellow' });
    expect(action.runs?.using).toBe('composite');
    expect(action.inputs?.mode?.default).toBe('compare');
    expect(action.inputs?.scenario?.default).toBe('');
    expect(action.inputs?.from?.required).toBe(false);
    expect(action.inputs?.last?.default).toBe('10');
    expect(action.inputs?.['max-runs']?.default).toBe('200');
    expect(action.inputs?.['fail-on-incompatible']?.default).toBe('true');
    expect(action.inputs?.['upload-results']?.default).toBe('true');
    expect(action.runs?.steps?.some((step) => step.id === 'canary')).toBe(true);
    expect(action.outputs).toHaveProperty('results-path');
    expect(action.outputs).toHaveProperty('report-path');
    expect(action.outputs).toHaveProperty('passed');
    expect(action.outputs).toHaveProperty('exit-code');

    const externalUses = action.runs?.steps?.map((step) => step.uses).filter(Boolean) ?? [];
    expect(externalUses).toHaveLength(2);
    expect(externalUses.every((value) => /@[0-9a-f]{40}$/.test(value ?? ''))).toBe(true);
  });

  it('publishes the CLI as claude-canary with a valid package version', async () => {
    const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(source) as { bin?: Record<string, string>; version?: string };

    expect(pkg.bin).toEqual({ 'claude-canary': 'dist/index.js' });
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});
