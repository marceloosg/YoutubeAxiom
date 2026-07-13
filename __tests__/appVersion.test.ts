import { resolveAppVersion } from '../src/util/appVersion';
import { composeShareLog } from '../src/log/shareLog';

describe('resolveAppVersion (s161)', () => {
  it('prefers expoConfig.version when present', () => {
    expect(resolveAppVersion('1.0.7', '1.0.4')).toBe('1.0.7');
  });

  it('falls back to package.json version when expoConfig.version is undefined', () => {
    expect(resolveAppVersion(undefined, '1.0.7')).toBe('1.0.7');
  });

  it('never returns the stale hardcoded 1.0.4 literal when a real version is supplied', () => {
    const resolved = resolveAppVersion('1.0.7', '1.0.7');
    expect(resolved).toMatch(/^\d+\.\d+\.\d+$/);
    expect(resolved).not.toBe('1.0.4');
  });

  it('feeds a variable version into the shareLog header, not a stale literal', () => {
    // Regression guard for the s161 device-log bug: shareLog header showed
    // "v1.0.4" while the installed build was v1.0.6. The header must reflect
    // whatever `resolveAppVersion` returns, matching a generic semver shape
    // rather than being locked to the old literal.
    const version = resolveAppVersion('1.0.7', '1.0.4');
    const header = composeShareLog({
      appVersion: version,
      context: 'vid123',
      atMs: Date.UTC(2026, 6, 13, 10, 25, 36),
      breadcrumbLines: [],
      networkLines: [],
    });

    expect(header).toMatch(/YoutubeAxiom v\d+\.\d+\.\d+/);
    expect(header).not.toContain('v1.0.4');
  });
});
