import { describe, expect, it } from 'vitest';
// @ts-expect-error dependency-free JavaScript helper intentionally has no declaration file.
import { buildCommentBody, COMMENT_MARKER, findExistingCanaryComment, pullRequestNumberFromEvent } from '../scripts/pr-comment.mjs';

describe('PR comment helper', () => {
  it('uses a stable hidden marker so reruns update one comment', () => {
    const body = buildCommentBody('## Report\n\nPASS', 'https://github.com/example/repo/actions/runs/1');
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('View Canary workflow run');
    expect(findExistingCanaryComment([
      { id: 1, body: 'other' },
      { id: 2, body },
    ])).toMatchObject({ id: 2 });
  });

  it('reads the PR number from a pull_request event', () => {
    expect(pullRequestNumberFromEvent({ pull_request: { number: 39 } })).toBe(39);
    expect(pullRequestNumberFromEvent({})).toBeUndefined();
  });
});
