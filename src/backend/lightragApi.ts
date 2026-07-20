import Constants from 'expo-constants';
import {
  loadLightragSecret,
  signBodyWithTimestamp,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../auth/hmac';

/**
 * Fetch helpers for the axiom-lightrag service (design doc
 * `docs/plans/2026-07-17-yt-app-arc-design.md` §3/§4/§10 "Phase 1 — MVP
 * loop (1 vid)"). Wire contract verified against the actual shipped
 * `infra/services/axiom-lightrag/main.py` (Phase 1 step 2, PR #407/#409/#412):
 *
 *   POST /ingest {"url": "<youtube url>"}
 *     -> 200 {"crawl_id", "video_id", "state": "indexed"}
 *     -> 400 {"error": "invalid_request" | "invalid_url"}
 *     -> 502 {"error": "transcript_fetch_failed", "detail"}
 *     -> 500 {"error": "index_failed", "detail"}
 *
 *   POST /ask {"query": "<question>"}
 *     -> 200 {"answer_text", "citations": []}
 *     -> 400 {"error": "invalid_request"}
 *     -> 500 {"error": "query_failed", "detail"}
 *
 * Both routes are HMAC-authed: `X-Axiom-Signature` = hex HMAC-SHA256(secret,
 * `${timestamp}.${body}`), `X-Axiom-Timestamp` = unix seconds (300s drift
 * tolerance). No `crawl_id` field on /ask in this MVP -- one global
 * working_dir server-side (design §10 Phase 1 simplification, confirmed in
 * `_process_ask`'s docstring). Do NOT add a crawl_id field here; it would be
 * silently ignored server-side and implies Phase-2 scope this PR doesn't
 * cover.
 */

function getLightragBaseUrl(): string {
  const url = Constants.expoConfig?.extra?.lightragBaseUrl as string | undefined;
  if (!url) {
    throw new Error(
      'LIGHTRAG_BASE not configured. Set `extra.lightragBaseUrl` in app.json / eas.json.'
    );
  }
  return url.replace(/\/$/, '');
}

async function postSigned(
  path: string,
  body: Record<string, unknown>,
  customFetch?: typeof fetch
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const secret = await loadLightragSecret();
  if (!secret) {
    throw new Error(
      'LightRAG HMAC secret not configured. Set it via the in-app config screen ' +
        'or `extra.lightragSecret` in app.json / eas.json.'
    );
  }

  const baseUrl = getLightragBaseUrl();
  const jsonBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signBodyWithTimestamp(secret, timestamp, jsonBody);

  const doFetch = customFetch ?? globalThis.fetch;
  const response = await doFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: String(timestamp),
    },
    body: jsonBody,
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    // Non-JSON / empty body -- fall through with {} so callers can still
    // inspect response.status via the thrown error message below.
  }

  return { status: response.status, payload };
}

export interface IngestResult {
  crawl_id: string;
  video_id: string;
  state: string;
}

/**
 * POSTs a YouTube URL to `/ingest`. Single-URL only for MVP (design §9 Q9:
 * full pipeline on 1 video) -- no crawl selector, no batch/playlist/channel.
 * Throws on any non-200 response; the caller renders the error message
 * inline (brief: "queued" -> "success (video_id=...)" or "error: <message>").
 */
export async function postIngest(
  url: string,
  customFetch?: typeof fetch
): Promise<IngestResult> {
  const { status, payload } = await postSigned('/ingest', { url }, customFetch);
  if (status !== 200) {
    const detail = typeof payload.error === 'string' ? payload.error : `http_${status}`;
    throw new Error(detail);
  }
  return payload as unknown as IngestResult;
}

export interface AskResult {
  answer_text: string;
  citations: Array<{ vid: string; start_ts: number; end_ts: number }>;
}

/**
 * POSTs a natural-language query to `/ask`. Streaming not required for MVP
 * (design §10 Phase 1) -- single response, rendered once resolved.
 */
export async function postAsk(query: string, customFetch?: typeof fetch): Promise<AskResult> {
  const { status, payload } = await postSigned('/ask', { query }, customFetch);
  if (status !== 200) {
    const detail = typeof payload.error === 'string' ? payload.error : `http_${status}`;
    throw new Error(detail);
  }
  return payload as unknown as AskResult;
}
