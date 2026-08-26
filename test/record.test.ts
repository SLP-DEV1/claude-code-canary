import { describe, expect, it } from 'vitest';
import {
  assertPortableCommands,
  buildRecordedScenario,
  recordingSlug,
  redactSensitiveText,
  type RecordingState,
} from '../src/record.js';

const state: RecordingState = {
  schemaVersion: 1,
  name: 'auth-fix',
  prompt: 'Fix the auth regression.',
  promptRedacted: false,
  startCommit: '0123456789abcdef0123456789abcdef01234567',
  createdAt: '2026-08-26T00:00:00.000Z',
  setupCommands: ['npm ci'],
  verifyCommands: ['npm test'],
  claude: {
    executable: 'claude',
    version: '2.1.237 (Claude Code)',
    model: 'sonnet',
  },
  configFiles: ['CLAUDE.md', '.mcp.json'],
};

describe('record/replay helpers', () => {
  it('normalizes safe recording names and rejects traversal', () => {
    expect(recordingSlug('Auth-Fix_1')).toBe('auth-fix_1');
    expect(() => recordingSlug('../escape')).toThrow(/recording name/i);
    expect(() => recordingSlug('')).toThrow(/recording name/i);
  });

  it('redacts common credentials and machine-specific paths', () => {
    const input = [
      'Use gsk_abcdefghijklmnopqrstuvwxyz123456',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
      'Open C:\\Users\\alice\\project\\secret.txt',
      'Then inspect /home/alice/project/file.ts',
      'password=hunter2',
    ].join('\n');
    const redacted = redactSensitiveText(input);

    expect(redacted).not.toContain('gsk_abcdefghijklmnopqrstuvwxyz123456');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(redacted).not.toContain('C:\\Users\\alice');
    expect(redacted).not.toContain('/home/alice');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).toContain('[REDACTED');
    expect(redacted).toContain('<ABSOLUTE_PATH>');
  });

  it('rejects secret-bearing or absolute-path setup/verification commands', () => {
    expect(assertPortableCommands(['npm test', 'pytest -q'])).toEqual(['npm test', 'pytest -q']);
    expect(() => assertPortableCommands(['API_KEY=sk-abcdefghijklmnopqrstuvwxyz npm test'])).toThrow(/refusing to persist/i);
    expect(() => assertPortableCommands(['/opt/tools/test-runner'])).toThrow(/refusing to persist/i);
  });

  it('builds reviewable deterministic replay assertions', () => {
    const scenario = buildRecordedScenario(
      state,
      ['src/auth.ts', 'test/auth.test.ts'],
      ['src/auth.ts', 'test/auth.test.ts'],
      [],
      ['npm ci'],
      ['npm test'],
    );

    expect(scenario.recording?.git_commit).toBe(state.startCommit);
    expect(scenario.recording?.claude_version).toBe('2.1.237 (Claude Code)');
    expect(scenario.recording?.config_files).toEqual(['CLAUDE.md', '.mcp.json']);
    expect(scenario.expect?.changed_files?.allow).toEqual(['src/auth.ts', 'test/auth.test.ts']);
    expect(scenario.expect?.changed_files?.require).toEqual(['src/auth.ts', 'test/auth.test.ts']);
    expect(scenario.verify?.commands).toEqual(['npm test']);
    expect(scenario.setup?.commands).toEqual(['npm ci']);
  });
});
