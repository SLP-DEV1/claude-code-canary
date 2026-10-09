import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBytes } from '../src/versions.js';

afterEach(() => vi.unstubAllGlobals());

describe('release metadata download limits', () => {
  it('bounds streamed responses when content-length is omitted', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    })));
    await expect(fetchBytes('https://example.invalid/manifest', 10)).rejects.toThrow(/too large/i);
  });

  it('reads a small response without a declared content length', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    })));
    const result = await fetchBytes('https://example.invalid/manifest', 10);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });
});
