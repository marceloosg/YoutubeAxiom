import Constants from 'expo-constants';
import { signBody } from '../auth/hmac';

/**
 * Path K backend proxy client -- `axiom-yt-transcript` (port 8737, systemd on
 * the axiom EC2 box). Wire contract verified against the actual shipped
 * `infra/axiom-yt-transcript/main.py` + `get_transcript.py` in the axiom-workspace
 * repo (s176-follow, msg 8837/8811):
 *
 *   POST /transcript {"video_id": "<11-char id>"}
 *     -> 200 {"video_id", "source": "auto"|"manual", "srv1_xml", "text", "byte_len"}
 *     -> 401 {"error": "unauthorized"}                (HMAC mismatch)
 *     -> 400 {"error": "invalid JSON body" | "video_id is required"}
 *     -> 500 {"error": "...", "diagnostic": "...", "video_id"}
 *
 * Auth: `X-Axiom-Auth` header = hex HMAC-SHA256(secret, raw_body) -- NOT the
 * timestamped scheme axiom-lightrag uses (`X-Axiom-Signature` +
 * `X-Axiom-Timestamp`, see lightragApi.ts). Path K's `_valid_hmac` in main.py
 * signs the raw body only, no timestamp component -- same primitive `signBody`
 * already implements for the Lambda /yt-transcript webhook (src/backend/api.ts),
 * so it's reused here rather than duplicated.
 *
 * This client is a FIRST-TIER extraction attempt, ahead of the existing
 * in-app youtubei.js chain (see src/scrape/youtubeiClient.ts). Any failure
 * mode here (unconfigured, network error, non-200, empty text) resolves to
 * `null` so the caller falls through to in-app extraction -- this module
 * never throws.
 */

const AUTH_HEADER = 'X-Axiom-Auth';

export interface BackendProxyConfig {
  baseUrl: string;
  secret: string;
}

export interface BackendProxyResult {
  source: string;
  text: string;
  byteLen: number;
  /** srv1 XML payload, when present -- lets the caller reuse the existing
   * `parseTimedtextSrv1` line-mapper for real per-line timestamps instead of
   * treating the whole transcript as one opaque line. */
  srv1Xml?: string;
}

export type ProxyBreadcrumb = (label: string) => void;

/**
 * Reads `extra.ytTranscriptBaseUrl` / `extra.ytTranscriptSecret` from
 * `Constants.expoConfig` (build-time, EAS-secret-injected -- mirrors the
 * `lightragBaseUrl`/`lightragSecret` pattern from app.config.js, PR #14).
 * Returns `null` when either is unset/empty -- the proxy tier is then skipped
 * entirely (no fetch attempt, no breadcrumb) so existing device logs / tests
 * that don't configure these extras are unaffected.
 */
export function getBackendProxyConfig(): BackendProxyConfig | null {
  const baseUrl = Constants.expoConfig?.extra?.ytTranscriptBaseUrl as string | undefined;
  const secret = Constants.expoConfig?.extra?.ytTranscriptSecret as string | undefined;
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), secret };
}

/** Best-effort class-name label for a caught error, single-lined + truncated.
 * Mirrors `errorClassName` in youtubeiClient.ts (kept local to avoid a
 * cross-module dependency for a two-line helper). */
function errorClassName(err: unknown): string {
  if (err instanceof Error) {
    const msg = (err.message ?? '').slice(0, 100).replace(/[\r\n]+/g, ' ');
    return msg ? `${err.constructor.name}:${msg}` : err.constructor.name;
  }
  return 'UnknownError';
}

/**
 * Attempts to fetch a transcript via the Path K backend proxy. Returns the
 * parsed result on success, `null` on any failure -- never throws, so the
 * caller can treat this as a plain fallback-eligible tier.
 *
 * Emits `backend_proxy_ok` on success and `backend_proxy_fail=<reason>` on
 * any failure via `onBreadcrumb` (matches the `<client>_error=` /
 * `<client>_tracks=N` naming convention in youtubeiClient.ts). `onBreadcrumb`
 * defaults to a no-op so this module can be unit-tested without a logger.
 */
export async function fetchTranscriptViaProxy(
  videoId: string,
  config: BackendProxyConfig,
  customFetch?: typeof fetch,
  onBreadcrumb: ProxyBreadcrumb = () => {}
): Promise<BackendProxyResult | null> {
  const jsonBody = JSON.stringify({ video_id: videoId });
  const signature = signBody(config.secret, jsonBody);

  const doFetch = customFetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(`${config.baseUrl}/transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [AUTH_HEADER]: signature,
      },
      body: jsonBody,
    });
  } catch (err) {
    onBreadcrumb(`backend_proxy_fail=${errorClassName(err)}`);
    return null;
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch (err) {
    onBreadcrumb(`backend_proxy_fail=bad_json:${errorClassName(err)}`);
    return null;
  }

  if (response.status !== 200) {
    const detail = typeof payload.error === 'string' ? payload.error : `http_${response.status}`;
    onBreadcrumb(`backend_proxy_fail=${detail}`);
    return null;
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!text) {
    onBreadcrumb('backend_proxy_fail=empty_text');
    return null;
  }

  onBreadcrumb('backend_proxy_ok');
  return {
    source: typeof payload.source === 'string' ? payload.source : 'unknown',
    text,
    byteLen: typeof payload.byte_len === 'number' ? payload.byte_len : text.length,
    srv1Xml: typeof payload.srv1_xml === 'string' ? payload.srv1_xml : undefined,
  };
}
