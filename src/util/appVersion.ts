/**
 * Resolves the app version string shown in the shareLog header (and anywhere
 * else the running build number needs to be surfaced).
 *
 * s161 fix: `App.tsx` used to hardcode `const APP_VERSION = '1.0.4'`. Marcelo's
 * 2026-07-13 v1.0.6 device test still showed the shareLog header reporting
 * "YoutubeAxiom v1.0.4" -- the constant was never bumped alongside real
 * releases (v1.0.5, v1.0.6), so the header silently lied about which build
 * produced the log. Extracted to a pure function (rather than inlining the
 * `??` fallback in App.tsx) so the resolution logic is unit-testable without
 * rendering the full native component tree.
 */

/**
 * @param expoConfigVersion `Constants.expoConfig?.version` -- populated from
 *   `app.json`'s `expo.version` at build time. Preferred source since it's
 *   what actually ships in the built APK/IPA.
 * @param packageJsonVersion `package.json`'s `version` field. Fallback for
 *   environments where `expoConfig` isn't populated (e.g. bare Jest/web runs).
 */
export function resolveAppVersion(
  expoConfigVersion: string | undefined,
  packageJsonVersion: string
): string {
  return expoConfigVersion ?? packageJsonVersion;
}
