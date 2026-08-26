import { describe, expect, it } from 'vitest';
// The marketplace runner is intentionally dependency-free JavaScript so it can execute before Canary itself.
// @ts-expect-error JavaScript helper module intentionally has no declaration file.
import { buildCliArgs, parseBoolean, parsePositiveInteger, parseVersions } from '../scripts/action-runner.mjs';

describe('marketplace action runner', () => {
  it('builds backwards-compatible compare arguments', () => {
    expect(buildCliArgs({
      mode: 'compare',
      scenario: '',
      from: '2.1.100',
      to: '',
      plugin: '',
      suite: '',
      versions: [],
      last: 10,
      platform: '',
      maxRuns: 200,
      failOnIncompatible: true,
    })).toEqual(['compare', '.canary/basic.canary.yml', '--from', '2.1.100', '--to', 'latest']);
  });

  it('builds a full plugin-suite command without shell interpolation', () => {
    expect(buildCliArgs({
      mode: 'plugin-suite',
      scenario: '',
      from: '',
      to: '',
      plugin: './plugins/my plugin',
      suite: '.canary/plugins/my plugin',
      versions: ['2.1.100', '2.1.101'],
      last: 10,
      platform: 'linux-x64',
      maxRuns: 120,
      failOnIncompatible: false,
    })).toEqual([
      'plugin-suite',
      '--plugin', './plugins/my plugin',
      '--versions', '2.1.100', '2.1.101',
      '--suite', '.canary/plugins/my plugin',
      '--platform', 'linux-x64',
      '--max-runs', '120',
      '--allow-incompatible',
    ]);
  });

  it('validates action inputs before invoking Canary', () => {
    expect(parseVersions('2.1.1, 2.1.2 2.1.1')).toEqual(['2.1.1', '2.1.2']);
    expect(() => parseVersions('latest')).toThrow(/exact x\.y\.z/i);
    expect(parseBoolean('yes', 'flag')).toBe(true);
    expect(parseBoolean('off', 'flag')).toBe(false);
    expect(() => parseBoolean('maybe', 'flag')).toThrow(/true or false/i);
    expect(parsePositiveInteger('20', 'count')).toBe(20);
    expect(() => parsePositiveInteger('0', 'count')).toThrow(/positive integer/i);
  });

  it('requires mode-specific inputs', () => {
    expect(() => buildCliArgs({ mode: 'compare', from: '', to: '', scenario: '', plugin: '', suite: '', versions: [], last: 10, platform: '', maxRuns: 200, failOnIncompatible: true }))
      .toThrow(/from is required/i);
    expect(() => buildCliArgs({ mode: 'plugin-suite', from: '', to: '', scenario: '', plugin: '', suite: '', versions: [], last: 10, platform: '', maxRuns: 200, failOnIncompatible: true }))
      .toThrow(/plugin is required/i);
    expect(() => buildCliArgs({ mode: 'plugin-matrix', from: '2.1.1', to: '', scenario: '', plugin: './p', suite: '', versions: [], last: 10, platform: '', maxRuns: 200, failOnIncompatible: true }))
      .toThrow(/from and to must be provided together/i);
  });
});
