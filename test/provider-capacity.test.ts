import { describe, expect, it } from 'vitest';
// @ts-expect-error Test helper is intentionally plain JS, mirroring the headless provider router.
import { isTerminalProviderCapacityFailure, terminalModelRequestStatus } from '../scripts/provider-capacity.mjs';

function log(...statuses: number[]): string {
  return statuses.map((status, i) => [
    JSON.stringify({ reqId: `req-${i}`, req: { method: 'POST', url: '/v1/messages?beta=true' } }),
    JSON.stringify({ reqId: `req-${i}`, res: { statusCode: status } }),
  ].join('\n')).join('\n');
}

describe('provider fallback attribution', () => {
  it('accepts a terminal 429 or 503 provider response', () => {
    expect(isTerminalProviderCapacityFailure(log(200, 429))).toBe(true);
    expect(isTerminalProviderCapacityFailure(log(503))).toBe(true);
  });

  it('does not infer an outage from a stale provider error', () => {
    expect(terminalModelRequestStatus(log(503, 200))).toBe(200);
    expect(isTerminalProviderCapacityFailure(log(503, 200))).toBe(false);
    expect(isTerminalProviderCapacityFailure(log(500))).toBe(false);
  });

  it('ignores unrelated status messages and textual errors', () => {
    const unrelated = JSON.stringify({ reqId: 'x', res: { statusCode: 429 }, msg: 'unrelated' });
    expect(isTerminalProviderCapacityFailure(log(200) + '\n' + unrelated)).toBe(false);
    expect(isTerminalProviderCapacityFailure('429 quota error elsewhere')).toBe(false);
  });
});
