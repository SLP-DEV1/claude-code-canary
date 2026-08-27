import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import { buildClaudeArgs } from '../src/runner.js';

describe('Claude invocation arguments', () => {
  it('always enables verbose when using stream-json output', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'stream-json-smoke',
      prompt: 'Say OK',
      claude: {},
    });

    const args = buildClaudeArgs(scenario);

    expect(args.slice(0, 6)).toEqual([
      '-p',
      'Say OK',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
    ]);
  });

  it('keeps scenario options and prepared extra arguments', () => {
    const scenario = parseScenario({
      version: 1,
      name: 'configured-run',
      prompt: 'Fix the test',
      claude: {
        args: ['--append-system-prompt', 'Canary fixture'],
        model: 'test-model',
        permission_mode: 'acceptEdits',
        include_hook_events: true,
        max_turns: 7,
        max_budget_usd: 2,
      },
    });

    const args = buildClaudeArgs(scenario, ['--plugin-dir', '/tmp/plugin']);

    expect(args).toEqual([
      '-p',
      'Fix the test',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--include-hook-events',
      '--model',
      'test-model',
      '--permission-mode',
      'acceptEdits',
      '--max-turns',
      '7',
      '--max-budget-usd',
      '2',
      '--append-system-prompt',
      'Canary fixture',
      '--plugin-dir',
      '/tmp/plugin',
    ]);
  });

  it('automatically enables lifecycle events when semantic assertions need them', () => {
    const permissionScenario = parseScenario({
      version: 1,
      name: 'permission-semantics',
      prompt: 'Read a file',
      expect: { permissions: { max_prompts: 0 } },
    });
    const hookScenario = parseScenario({
      version: 1,
      name: 'hook-semantics',
      prompt: 'Read a file',
      regressions: { require_same_hook_sequence: true },
    });

    expect(buildClaudeArgs(permissionScenario)).toContain('--include-hook-events');
    expect(buildClaudeArgs(hookScenario)).toContain('--include-hook-events');
  });
});
