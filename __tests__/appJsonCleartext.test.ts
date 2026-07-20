import appJson from '../app.json';

/**
 * Regression guard for the s176 cleartext bug: `app.json`'s top-level
 * `expo.android.usesCleartextTraffic` field is NOT part of the Expo config
 * schema on this SDK -- `npx expo prebuild` silently drops it, so the
 * generated AndroidManifest.xml never gets the attribute and on-device
 * requests to the (HTTP-only) axiom-lightrag backend fail with
 * `CLEARTEXT communication ... not permitted by network security policy`.
 *
 * The blessed path is the `expo-build-properties` config plugin, which DOES
 * write `android.usesCleartextTraffic` into the generated manifest during
 * prebuild. This test locks in that placement so a future edit can't
 * silently move the flag back to the ineffective top-level location.
 */
describe('app.json cleartext traffic config (s176)', () => {
  const plugins = appJson.expo.plugins as Array<string | [string, Record<string, unknown>]>;

  it('configures usesCleartextTraffic via the expo-build-properties plugin', () => {
    const buildPropertiesEntry = plugins.find(
      (p) => p === 'expo-build-properties' || (Array.isArray(p) && p[0] === 'expo-build-properties')
    );

    expect(buildPropertiesEntry).toBeDefined();
    expect(Array.isArray(buildPropertiesEntry)).toBe(true);

    const [, options] = buildPropertiesEntry as [string, Record<string, unknown>];
    const android = options.android as Record<string, unknown>;
    expect(android.usesCleartextTraffic).toBe(true);
  });

  it('does not leave usesCleartextTraffic at the ineffective top-level expo.android path', () => {
    // This path is silently dropped by `npx expo prebuild` on this SDK -- it
    // never reaches the generated AndroidManifest.xml. Regression guard
    // against reintroducing it alongside (or instead of) the plugin config.
    expect((appJson.expo.android as Record<string, unknown>).usesCleartextTraffic).toBeUndefined();
  });

  it('keeps expo.version a valid semver string regardless of version bump (parametric, not hardcoded)', () => {
    // Read the version straight from app.json rather than hardcoding a
    // literal -- this test must keep passing across future version bumps
    // without edits, so the plugin-config assertions above stay wired to
    // whatever build is current.
    expect(typeof appJson.expo.version).toBe('string');
    expect(appJson.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
