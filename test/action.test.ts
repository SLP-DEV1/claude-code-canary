import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('Claude Canary GitHub Action', () => {
  it('exposes the multi-mode composite action contract including suite/watch', async () => {
    const source = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
    const action = parse(source) as {
      name?: string;
      description?: string;
      branding?: { icon?: string; color?: string };
      inputs?: Record<string, { required?: boolean; default?: string }>;
      runs?: { using?: string; steps?: Array<{ id?: string; uses?: string; name?: string; continueOnError?: boolean }> };
      outputs?: Record<string, unknown>;
    };

    expect(action.name).toBe('Claude Code Canary');
    expect(action.description).toMatch(/regression-test/i);
    expect(action.description!.length).toBeLessThan(125);
    expect(action.branding).toEqual({ icon: 'activity', color: 'yellow' });
    expect(action.runs?.using).toBe('composite');
    expect(action.inputs?.mode?.default).toBe('compare');
    expect(action.inputs?.scenario?.default).toBe('');
    expect(action.inputs?.from?.required).toBe(false);
    expect(action.inputs?.['base-ref']?.default).toBe('');
    expect(action.inputs?.['head-ref']?.default).toBe('');
    expect(action.inputs?.baseline?.default).toBe('');
    expect(action.inputs?.['mcp-contract']?.default).toBe('');
    expect(action.inputs?.['mcp-require-baseline']?.default).toBe('true');
    expect(action.inputs?.['comment-pr']?.default).toBe('false');
    expect(action.inputs?.last?.default).toBe('10');
    expect(action.inputs?.['max-runs']?.default).toBe('200');
    expect(action.inputs?.['fail-on-incompatible']?.default).toBe('true');
    expect(action.inputs?.['reuse-results']?.default).toBe('false');
    expect(action.inputs?.['check-only']?.default).toBe('false');
    expect(action.inputs?.tag?.default).toBe('');
    expect(action.inputs?.shard?.default).toBe('');
    expect(action.inputs?.['watch-state']?.default).toBe('');
    expect(action.inputs?.['watch-good']?.default).toBe('');
    expect(action.inputs?.['upload-results']?.default).toBe('true');
    expect(action.runs?.steps?.some((step) => step.id === 'canary')).toBe(true);
    expect(action.runs?.steps?.some((step) => step.name === 'Ensure pull request refs are available')).toBe(true);
    expect(action.runs?.steps?.some((step) => step.name === 'Update Claude Canary pull request comment')).toBe(true);
    expect(action.outputs).toHaveProperty('results-path');
    expect(action.outputs).toHaveProperty('report-path');
    expect(action.outputs).toHaveProperty('passed');
    expect(action.outputs).toHaveProperty('exit-code');

    const externalUses = action.runs?.steps?.map((step) => step.uses).filter(Boolean) ?? [];
    expect(externalUses).toHaveLength(2);
    expect(externalUses.every((value) => /@[0-9a-f]{40}$/.test(value ?? ''))).toBe(true);
  });

  it('publishes the compatibility CLI as claude-canary with a valid package version', async () => {
    const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(source) as { bin?: Record<string, string>; version?: string };

    expect(pkg.bin).toEqual({ 'claude-canary': 'dist/v2-cli.js' });
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});
