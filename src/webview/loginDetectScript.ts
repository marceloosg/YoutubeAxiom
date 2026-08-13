/**
 * Injected-JS + message protocol for detecting YouTube login state inside
 * `LoginWebView.tsx` (s193, D19 Shape A).
 *
 * The design doc's original plan (mock §2) named two detection signals:
 * "SAPISID/__Secure-1PSID in the WebView cookie jar (@react-native-cookies/cookies)
 * OR the avatar element." `@react-native-cookies/cookies` turned out to be
 * unbuildable on this repo's Gradle/AGP toolchain -- its bundled
 * `android/build.gradle` calls the long-removed `jcenter()` repository method
 * and hard-fails `assembleRelease` in CI (verified: PR build run, "Could not
 * find method jcenter()"). Rather than add a second native dependency to
 * chase a fix, this uses ONLY the avatar-element OR-branch the design doc
 * already sanctioned -- no native module, no CI risk, same detection intent.
 *
 * Split into its own pure-testable module for the same reason as
 * `injectedExtractionScript.ts`: the JS string + its message parser are
 * unit-tested without pulling `react-native-webview` into Jest.
 */

export interface LoginStatusMessage {
  type: 'yt_login_status';
  signedIn: boolean;
}

/**
 * Parses a raw `WebViewMessageEvent.nativeEvent.data` string into a typed
 * login-status message. Returns `null` for anything that isn't valid JSON or
 * doesn't match the expected shape.
 */
export function parseLoginStatusMessage(raw: string): LoginStatusMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type === 'yt_login_status' && typeof obj.signedIn === 'boolean') {
    return { type: 'yt_login_status', signedIn: obj.signedIn };
  }
  return null;
}

/**
 * Injected into the visible login WebView after every navigation (the
 * Google login flow crosses several pages -- form, possible 2FA, then a
 * redirect to youtube.com). Looks for YouTube's account-avatar button, which
 * only renders once signed in; posts the result back on load and again on
 * any DOM mutation for up to 20s (covers the header finishing its own async
 * render after the redirect lands).
 */
export const LOGIN_DETECT_INJECTED_JS = `
(function () {
  function post(msg) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (e) {}
  }

  function checkLoggedIn() {
    var avatar = document.querySelector(
      '#avatar-btn, button#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn, [aria-label*="Google Account" i]'
    );
    post({ type: 'yt_login_status', signedIn: !!avatar });
  }

  if (document.readyState === 'complete') {
    checkLoggedIn();
  } else {
    window.addEventListener('load', checkLoggedIn);
  }

  var observer = new MutationObserver(checkLoggedIn);
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
  setTimeout(function () {
    observer.disconnect();
  }, 20000);
})();
true;
`;
