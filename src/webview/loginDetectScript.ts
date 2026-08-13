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
 * chase a fix, this drops the cookie-jar plan entirely -- no native module,
 * no CI risk.
 *
 * s193 device-test fix: the original avatar-only detector never fired
 * because `LoginWebView` loaded without a desktop `userAgent`, so the
 * post-login redirect landed on `m.youtube.com` (mobile layout) where
 * `#avatar-btn` doesn't exist -- that selector is desktop-only DOM. The
 * primary signal is now `window.ytcfg`'s own `LOGGED_IN` flag, which YouTube
 * sets on every youtube.com page load (mobile AND desktop) and is far more
 * reliable than scraping a specific header element. The avatar-element check
 * is kept as a secondary OR-signal (broadened with a couple of mobile-layout
 * selectors) purely as belt-and-suspenders in case `ytcfg` shape ever
 * changes. `LoginWebView` also now sets the same desktop UA as
 * `ExtractionWebView.tsx` so the post-login session is the desktop one --
 * consistent across both WebViews and no longer the source of the mismatch.
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
 * redirect to youtube.com) and again on load-end. Primary signal is
 * `window.ytcfg`'s `LOGGED_IN` flag (present on every youtube.com page,
 * mobile and desktop alike -- unlike the desktop-only avatar element).
 * Secondary OR-signal is the avatar/account-menu element, broadened to also
 * match a couple of mobile-layout (`ytm-*`) selectors. Only ever posts
 * `signedIn: true` -- while still on accounts.google.com (or before YouTube
 * has rendered its signed-in chrome) the script simply stays silent rather
 * than posting a `false` that could race a `true` from a later re-fire; the
 * re-fire on every navigation + DOM mutation (up to 20s) is what actually
 * catches the eventual signed-in state, so no "not logged in yet" message is
 * ever needed.
 */
export const LOGIN_DETECT_INJECTED_JS = `
(function () {
  function post(msg) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (e) {}
  }

  function isYouTubeHost() {
    try {
      return window.location.hostname.indexOf('youtube.com') !== -1;
    } catch (e) {
      return false;
    }
  }

  function ytcfgLoggedIn() {
    try {
      if (window.ytcfg && typeof window.ytcfg.get === 'function') {
        if (window.ytcfg.get('LOGGED_IN') === true) return true;
      }
      if (window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.LOGGED_IN === true) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function avatarSignedIn() {
    try {
      var el = document.querySelector(
        '#avatar-btn, button#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn, ' +
        'ytm-topbar-menu-button-renderer, ytm-topbar-menu-button-renderer img, ' +
        '[aria-label*="Google Account" i], [aria-label*="Account" i] img'
      );
      return !!el;
    } catch (e) {
      return false;
    }
  }

  function checkLoggedIn() {
    if (!isYouTubeHost()) return;
    if (ytcfgLoggedIn() || avatarSignedIn()) {
      post({ type: 'yt_login_status', signedIn: true });
    }
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
