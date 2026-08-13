/**
 * Pure login-detection helpers for the Shape A "Connect YouTube" flow (s193,
 * D19). Split out from the WebView component so the detection logic is unit
 * testable without pulling in `react-native-webview` /
 * `@react-native-cookies/cookies` (native modules -- no Jest transform config
 * for them, matches the existing split pattern e.g. segmentMap.ts vs
 * youtubeiClient.ts).
 */

/**
 * Cookie names that only appear in the WebView's cookie jar once a real
 * Google/YouTube login has completed (mock §2, Q1/Q2). Any one present is
 * sufficient -- Google rotates which of these it sets depending on account
 * type / consent state.
 */
const LOGIN_COOKIE_MARKERS = ['SAPISID', '__Secure-1PSID', '__Secure-3PAPISID', '__Secure-1PAPISID'];

/**
 * True when a raw `document.cookie`-shaped string (or the joined output of
 * `@react-native-cookies/cookies`'s `getAll()`) contains any of the
 * login-indicating cookie names. Defensive against `null`/`undefined`/empty
 * input (WebView not yet loaded, cookie manager returned nothing).
 */
export function cookieStringIndicatesLogin(cookieString: string | null | undefined): boolean {
  if (!cookieString) return false;
  return LOGIN_COOKIE_MARKERS.some((marker) => cookieString.includes(`${marker}=`));
}

/**
 * Fallback signal (mock §2 "OR the avatar element") for when cookie access is
 * unavailable or ambiguous: the injected DOM-check script postMessages a
 * boolean for whether YouTube's own header renders an account avatar
 * (`#avatar-btn`) instead of a "Sign in" link. Kept as a named predicate
 * rather than inlined so `LoginWebView.tsx` and any future caller share one
 * decision point.
 */
export function loginDetected(cookieHit: boolean, avatarElementHit: boolean): boolean {
  return cookieHit || avatarElementHit;
}
