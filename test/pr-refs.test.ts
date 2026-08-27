import { describe, expect, it } from 'vitest';
// @ts-expect-error dependency-free JavaScript helper intentionally has no declaration file.
import { exactPullRequestRefs, pullRequestFetchFallbacks } from '../scripts/ensure-pr-refs.mjs';

describe('PR ref discovery', () => {
  it('uses exact event SHAs by default', () => {
    const event = { pull_request: { number: 42, base: { sha: 'a'.repeat(40), ref: 'main' }, head: { sha: 'b'.repeat(40) } } };
    expect(exactPullRequestRefs(event)).toEqual({ base: 'a'.repeat(40), head: 'b'.repeat(40) });
    expect(pullRequestFetchFallbacks(event)).toEqual({
      base: 'refs/heads/main',
      head: 'refs/pull/42/head',
    });
  });

  it('keeps explicit user refs and disables event-derived fetch fallbacks', () => {
    const event = { pull_request: { number: 42, base: { ref: 'main' } } };
    expect(exactPullRequestRefs(event, 'origin/release', 'HEAD')).toEqual({ base: 'origin/release', head: 'HEAD' });
    expect(pullRequestFetchFallbacks(event, 'origin/release', 'HEAD')).toEqual({ base: undefined, head: undefined });
  });
});
