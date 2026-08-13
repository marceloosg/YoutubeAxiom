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

describe('LOGIN_DETECT_INJECTED_JS', () => {
  it('is a non-empty script string ending with `true;`', () => {
    expect(typeof LOGIN_DETECT_INJECTED_JS).toBe('string');
    expect(LOGIN_DETECT_INJECTED_JS.trim().endsWith('true;')).toBe(true);
  });

  it('checks for the avatar-btn element (mock §2 fallback signal)', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('avatar-btn');
  });

  it('posts a yt_login_status message', () => {
    expect(LOGIN_DETECT_INJECTED_JS).toContain('yt_login_status');
  });
});
