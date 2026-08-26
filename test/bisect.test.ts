import { describe, expect, it } from 'vitest';
import { findFirstBadIndex } from '../src/bisect.js';

describe('bisect search', () => {
  it('finds the first bad item with logarithmic probes', async () => {
    const calls: number[] = [];
    const firstBad = await findFirstBadIndex(
      33,
      async (index) => {
        calls.push(index);
        return index < 18;
      },
      (index) => `release-${index}`,
    );

    expect(firstBad).toBe(18);
    expect(calls[0]).toBe(0);
    expect(calls[1]).toBe(32);
    expect(calls.length).toBeLessThanOrEqual(7);
  });

  it('fails when the first item is already bad', async () => {
    await expect(findFirstBadIndex(4, async () => false)).rejects.toThrow(/first item is not good/i);
  });

  it('fails when the last item is still good', async () => {
    await expect(findFirstBadIndex(4, async () => true)).rejects.toThrow(/last item is not bad/i);
  });
});
