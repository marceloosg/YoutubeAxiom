import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';
import Constants from 'expo-constants';

/**
 * HMAC-SHA256 signing for backend POST requests.
 *
 * Mirrors the Kotlin `HmacAuth.kt` design intent: HMAC-SHA256(secret, body) -> hex,
 * carried in the `X-Axiom-Signature` header. Same crypto primitive, same encoding,
 * different runtime.
 */

const SECRET_STORE_KEY = 'axiom_webhook_secret';
export const SIGNATURE_HEADER = 'X-Axiom-Signature';

// axiom-lightrag (port 8738, PR #407/#409/#412) verifies a DIFFERENT secret
// than the Lambda /yt-transcript webhook above -- it loads its own from SSM
// `/axiom/lightrag/hmac_secret` (see infra/services/axiom-lightrag/main.py
// `_load_secret()`). Path K similarly has its own `AXIOM_YT_SECRET`. Each
// backend service in this system owns its own shared secret; this is a
// separate SecureStore slot for LightRAG's secret specifically, not a
// second secret for the same endpoint.
const LIGHTRAG_SECRET_STORE_KEY = 'axiom_lightrag_secret';
export const TIMESTAMP_HEADER = 'X-Axiom-Timestamp';

/**
 * Computes the hex-encoded HMAC-SHA256 signature of `body` using `secret`.
 * Byte-for-byte compatible with the Python reference:
 *   hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
 */
export function signBody(secret: string, body: string): string {
  return CryptoJS.HmacSHA256(body, secret).toString(CryptoJS.enc.Hex);
}

/**
 * Computes the hex-encoded HMAC-SHA256 signature axiom-lightrag expects:
 * HMAC-SHA256(secret, `${timestamp}.${body}`). Byte-for-byte compatible with
 * the Python reference (`_valid_hmac` in infra/services/axiom-lightrag/main.py):
 *   signed_payload = f"{timestamp}.".encode() + body_bytes
 *   hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
 */
export function signBodyWithTimestamp(secret: string, timestamp: number, body: string): string {
  return signBody(secret, `${timestamp}.${body}`);
}

/**
 * Loads the HMAC secret. Resolution order (documented decision, see PR body):
 *   1. expo-secure-store (persisted after first manual entry / config screen)
 *   2. Constants.expoConfig.extra.webhookSecret (build-time, via .env + eas.json)
 * Returns null if neither source has a value — caller should prompt for manual entry.
 */
export async function loadSecret(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(SECRET_STORE_KEY);
  if (stored) return stored;

  const Constants = await import('expo-constants');
  const buildTimeSecret = Constants.default.expoConfig?.extra?.webhookSecret as
    | string
    | undefined;
  return buildTimeSecret ?? null;
}

/**
 * Persists the HMAC secret to expo-secure-store (used by the in-app config screen
 * fallback when no build-time secret is baked in).
 */
export async function saveSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(SECRET_STORE_KEY, secret);
}

/**
 * Loads the axiom-lightrag HMAC secret. Same resolution order as `loadSecret`,
 * distinct storage key + build-time extra (`lightragSecret`) since this is a
 * different secret value than the Lambda webhook one.
 */
export async function loadLightragSecret(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(LIGHTRAG_SECRET_STORE_KEY);
  if (stored) return stored;

  // Static import (unlike `loadSecret` above's dynamic `import()`) -- the
  // dynamic form throws under Jest/node18 ("ES Modules in the VM API")
  // whenever this path is actually exercised in a test. `loadSecret` has
  // never been unit-tested past its SecureStore branch, so that latent bug
  // was never triggered; `loadLightragSecret` IS tested end-to-end here, so
  // it uses the top-level import already present in this module.
  const buildTimeSecret = Constants.expoConfig?.extra?.lightragSecret as string | undefined;
  return buildTimeSecret ?? null;
}

/**
 * Persists the axiom-lightrag HMAC secret to expo-secure-store.
 */
export async function saveLightragSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(LIGHTRAG_SECRET_STORE_KEY, secret);
}
