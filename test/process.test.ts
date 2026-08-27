import { describe, expect, it } from 'vitest';
import { spawnCapture } from '../src/process.js';

describe('process capture', () => {
  it('bounds captured output and marks truncation', async () => {
    const result = await spawnCapture(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(10000))'],
      { cwd: process.cwd(), timeoutMs: 10_000, maxOutputChars: 1024 },
    );

    expect(result.outputTruncated).toBe(true);
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(1024);
  });

  it('rejects invalid output limits before spawning', async () => {
    await expect(spawnCapture(process.execPath, ['--version'], {
      cwd: process.cwd(),
      maxOutputChars: 0,
    })).rejects.toThrow(/positive integer/i);
  });
});
