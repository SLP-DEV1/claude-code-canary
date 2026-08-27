import { describe, expect, it } from 'vitest';
// @ts-expect-error dependency-free JavaScript helper intentionally has no declaration file.
import { exactPullRequestRefs } from '../scripts/ensure-pr-refs.mjs';

describe('PR ref discovery', () => {
  it('uses exact event SHAs by default', () => {
    const event = { pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } };
    expect(exactPullRequestRefs(event)).toEqual({ base: 'a'.repeat(40), head: 'b'.repeat(40) });
  });

  it('keeps explicit user refs', () => {
    expect(exactPullRequestRefs({}, 'origin/release', 'HEAD')).toEqual({ base: 'origin/release', head: 'HEAD' });
  });
});
