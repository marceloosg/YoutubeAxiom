import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';

/**
 * HMAC-SHA256 signing for backend POST requests.
 *
 * Mirrors the Kotlin `HmacAuth.kt` design intent: HMAC-SHA256(secret, body) -> hex,
 * carried in the `X-Axiom-Signature` header. Same crypto primitive, same encoding,
 * different runtime.
 */

const SECRET_STORE_KEY = 'axiom_webhook_secret';
export const SIGNATURE_HEADER = 'X-Axiom-Signature';

/**
 * Computes the hex-encoded HMAC-SHA256 signature of `body` using `secret`.
 * Byte-for-byte compatible with the Python reference:
 *   hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
 */
export function signBody(secret: string, body: string): string {
  return CryptoJS.HmacSHA256(body, secret).toString(CryptoJS.enc.Hex);
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
