import { cookieStringIndicatesLogin, loginDetected } from '../src/webview/loginCheck';

describe('cookieStringIndicatesLogin (s193, D19 Shape A)', () => {
  it('returns false for null/undefined/empty input', () => {
    expect(cookieStringIndicatesLogin(null)).toBe(false);
    expect(cookieStringIndicatesLogin(undefined)).toBe(false);
    expect(cookieStringIndicatesLogin('')).toBe(false);
  });

  it('returns false when no login-indicating cookie is present', () => {
    expect(cookieStringIndicatesLogin('PREF=abc; CONSENT=YES+1')).toBe(false);
  });

  it('returns true when SAPISID is present', () => {
    expect(cookieStringIndicatesLogin('PREF=abc; SAPISID=xyz123; CONSENT=YES')).toBe(true);
  });

  it('returns true when __Secure-1PSID is present', () => {
    expect(cookieStringIndicatesLogin('__Secure-1PSID=abcdef')).toBe(true);
  });

  it('does not false-positive on a substring that is not an exact cookie-name match', () => {
    // "SAPISIDX" should not match the "SAPISID=" marker.
    expect(cookieStringIndicatesLogin('SAPISIDX=notreallyit')).toBe(false);
  });
});

describe('loginDetected', () => {
  it('is true if either signal is true', () => {
    expect(loginDetected(true, false)).toBe(true);
    expect(loginDetected(false, true)).toBe(true);
    expect(loginDetected(true, true)).toBe(true);
  });

  it('is false only when both signals are false', () => {
    expect(loginDetected(false, false)).toBe(false);
  });
});
