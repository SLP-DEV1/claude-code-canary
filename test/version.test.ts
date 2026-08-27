import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CANARY_VERSION } from '../src/version.js';

describe('release version', () => {
  it('keeps package.json and CLI version metadata in sync', async () => {
    const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(source) as { version?: string };
    expect(CANARY_VERSION).toBe(pkg.version);
  });
});
