import { describe, expect, it } from 'vitest';
import { compareExactVersions, publishedVersionsBetween } from '../src/release-catalog.js';

describe('Claude Code published release catalog', () => {
  const releases = [
    '2.1.237',
    '2.1.220',
    '2.1.223',
    '2.1.221',
    '2.1.229',
    '2.1.228',
    '2.1.227',
    '2.1.231',
    '2.1.224',
    '2.1.999-beta.1',
  ];

  it('sorts semantic versions numerically', () => {
    expect(compareExactVersions('2.1.9', '2.1.10')).toBeLessThan(0);
    expect(compareExactVersions('2.2.0', '2.1.999')).toBeGreaterThan(0);
  });

  it('returns only actually published versions inside the requested range', () => {
    expect(publishedVersionsBetween(releases, '2.1.220', '2.1.237')).toEqual([
      '2.1.220',
      '2.1.221',
      '2.1.223',
      '2.1.224',
      '2.1.227',
      '2.1.228',
      '2.1.229',
      '2.1.231',
      '2.1.237',
    ]);
  });

  it('rejects reversed or unpublished endpoints', () => {
    expect(() => publishedVersionsBetween(releases, '2.1.237', '2.1.220')).toThrow(/older than/i);
    expect(() => publishedVersionsBetween(releases, '2.1.222', '2.1.237')).toThrow(/not present/i);
  });
});
