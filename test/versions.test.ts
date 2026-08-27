import { describe, expect, it } from 'vitest';
import { isExactVersion, platformId, validatePlatformId } from '../src/versions.js';

describe('Claude Code version manager', () => {
  it('maps supported host platforms to Anthropic release platform ids', () => {
    expect(platformId('win32', 'x64', false)).toBe('win32-x64');
    expect(platformId('darwin', 'arm64', false)).toBe('darwin-arm64');
    expect(platformId('linux', 'x64', false)).toBe('linux-x64');
    expect(platformId('linux', 'arm64', true)).toBe('linux-arm64-musl');
  });

  it('rejects unsupported architectures', () => {
    expect(() => platformId('linux', 'ia32', false)).toThrow(/Unsupported architecture/);
  });

  it('accepts only known platform override ids', () => {
    expect(validatePlatformId('linux-x64')).toBe('linux-x64');
    expect(validatePlatformId('darwin-arm64')).toBe('darwin-arm64');
    expect(() => validatePlatformId('../linux-x64')).toThrow(/unsupported claude code platform id/i);
    expect(() => validatePlatformId('linux-x64/../../escape')).toThrow(/unsupported claude code platform id/i);
    expect(() => validatePlatformId('linux-x64\u0000')).toThrow(/unsupported claude code platform id/i);
  });

  it('accepts exact release versions only', () => {
    expect(isExactVersion('2.1.89')).toBe(true);
    expect(isExactVersion('latest')).toBe(false);
    expect(isExactVersion('2.1')).toBe(false);
  });
});
