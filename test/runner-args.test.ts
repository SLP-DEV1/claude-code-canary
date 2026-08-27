import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import { buildClaudeArgs } from '../src/runner.js';

describe('Claude CLI invocation', () => {
  it('uses --verbose with print-mode stream-json output', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'stream-json-smoke',
      prompt: 'Create canary-proof.txt',
      claude: {
        executable: 'claude',
        args: [],
        permission_mode: 'acceptEdits',
        max_turns: 10,
        max_budget_usd: 1,
        timeout_seconds: 300,
        env: {},
      },
    });

    const args = buildClaudeArgs(scenario);

    expect(args).toEqual(expect.arrayContaining([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--permission-mode',
      'acceptEdits',
      '--max-turns',
      '10',
      '--max-budget-usd',
      '1',
    ]));

    expect(args.indexOf('--verbose')).toBeGreaterThan(args.indexOf('stream-json'));
  });
});
