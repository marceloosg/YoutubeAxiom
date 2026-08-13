import {
  LOGIN_DETECT_INJECTED_JS,
  parseLoginStatusMessage,
} from '../src/webview/loginDetectScript';

describe('parseLoginStatusMessage (s193, D19 Shape A -- avatar-element login detection)', () => {
  it('parses a signed-in status message', () => {
    const raw = JSON.stringify({ type: 'yt_login_status', signedIn: true });
    expect(parseLoginStatusMessage(raw)).toEqual({ type: 'yt_login_status', signedIn: true });
  });

  it('parses a signed-out status message', () => {
    const raw = JSON.stringify({ type: 'yt_login_status', signedIn: false });
    expect(parseLoginStatusMessage(raw)).toEqual({ type: 'yt_login_status', signedIn: false });
  });

  it('returns null for invalid JSON', () => {
    expect(parseLoginStatusMessage('not json{')).toBeNull();
  });

  it('returns null for a differently-typed message (e.g. an extraction message)', () => {
    expect(
      parseLoginStatusMessage(JSON.stringify({ type: 'yt_extract_result', segments: [] }))
    ).toBeNull();
  });

  it('returns null when signedIn is not a boolean', () => {
    expect(
      parseLoginStatusMessage(JSON.stringify({ type: 'yt_login_status', signedIn: 'yes' }))
    ).toBeNull();
  });
});

describe('LOGIN_DETECT_INJECTED_JS (s193 device-test fix -- ytcfg primary signal)', () => {
  it('is a non-empty script string ending with `true;`', () => {
    expect(typeof LOGIN_DETECT_INJECTED_JS).toBe('string');
    expect(LOGIN_DETECT_INJECTED_JS.trim().endsWith('true;')).toBe(true);
  });

  it('checks window.ytcfg.get(\'LOGGED_IN\') as the primary signal', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('ytcfg');
    expect(LOGIN_DETECT_INJECTED_JS).toContain('LOGGED_IN');
    expect(LOGIN_DETECT_INJECTED_JS).toContain("ytcfg.get('LOGGED_IN')");
  });

  it('falls back to ytcfg.data_.LOGGED_IN', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('ytcfg.data_');
  });

  it('still checks the avatar-btn element as a secondary OR-signal', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('avatar-btn');
  });

  it('also matches a mobile-layout (ytm-*) avatar selector', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('ytm-topbar-menu-button-renderer');
  });

  it('only checks on a youtube.com host (not accounts.google.com)', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('youtube.com');
    expect(LOGIN_DETECT_INJECTED_JS).toContain('isYouTubeHost');
  });

  it('posts a yt_login_status message', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('yt_login_status');
  });

  it('only ever posts signedIn: true (never a racy false)', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('signedIn: true');
    expect(LOGIN_DETECT_INJECTED_JS).not.toContain('signedIn: false');
    expect(LOGIN_DETECT_INJECTED_JS).not.toContain('signedIn: !!');
  });

  it('re-observes DOM mutations for up to 20s, matching prior behavior', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('MutationObserver');
    expect(LOGIN_DETECT_INJECTED_JS).toContain('20000');
  });
});
