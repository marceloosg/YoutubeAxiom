import type { NetworkLogEntry } from './networkLog';

const REQ_BODY_PREVIEW_MAX = 400;
const RESP_BODY_PREVIEW_MAX = 800;
const REDACT_HEADER_RE = /signature|auth|cookie/i;
const REDACT_BODY_KEYS = new Set(['visitor_data', 'visitorData']);
const REDACTED = '<redacted>';

/** Redact sensitive header values in the preview (does not mutate the real headers). */
function redactHeadersPreview(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const h =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Array.isArray(headers)
      ? headers
      : Object.entries(headers);
  for (const [k, v] of h) {
    out[k] = REDACT_HEADER_RE.test(k) ? REDACTED : String(v);
  }
  return out;
}

/** Try to parse and redact a JSON body; on failure return truncated raw. */
function previewBody(raw: string, max: number): { keys?: string[]; preview: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const redacted: Record<string, unknown> = { ...parsed };
      for (const key of Object.keys(redacted)) {
        if (REDACT_BODY_KEYS.has(key)) {
          redacted[key] = REDACTED;
        }
      }
      const pretty = JSON.stringify(redacted);
      return {
        keys: Object.keys(parsed),
        preview: pretty.length > max ? pretty.slice(0, max) + '...' : pretty,
      };
    }
    return { preview: raw.length > max ? raw.slice(0, max) + '...' : raw };
  } catch {
    return { preview: raw.length > max ? raw.slice(0, max) + '...' : raw };
  }
}

function extractRequestBody(init?: RequestInit): string | undefined {
  if (!init || init.body === undefined || init.body === null) return undefined;
  if (typeof init.body === 'string') return init.body;
  // Non-string bodies (Blob/FormData/ArrayBuffer/URLSearchParams): stringify a marker.
  try {
    // URLSearchParams has toString
    if (typeof (init.body as URLSearchParams).toString === 'function') {
      return (init.body as URLSearchParams).toString();
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Wrap a fetch implementation so every call logs a req + resp entry.
 * Clones the Response to read the body preview without consuming the caller's stream.
 * Best-effort redaction: header keys matching /signature|auth|cookie/i and top-level
 * body keys `visitor_data` / `visitorData` are replaced with `<redacted>` in the preview.
 */
export function makeInstrumentedFetch(
  push: (e: NetworkLogEntry) => void,
  baseFetch: typeof fetch = globalThis.fetch
): typeof fetch {
  return async function instrumentedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const method =
      (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')) ||
      'GET';

    const rawReqBody = extractRequestBody(init);
    let reqKeys: string[] | undefined;
    let reqPreview: string | undefined;
    if (rawReqBody !== undefined) {
      const { keys, preview } = previewBody(rawReqBody, REQ_BODY_PREVIEW_MAX);
      reqKeys = keys;
      reqPreview = preview;
    } else if (init?.body !== undefined && init.body !== null) {
      // Non-serialisable body -- record size marker only.
      const bytes =
        (init.body as ArrayBuffer).byteLength ??
        (typeof (init.body as Blob).size === 'number' ? (init.body as Blob).size : undefined);
      reqPreview = bytes !== undefined ? `<${bytes}B>` : '<binary>';
    }

    const headersPreview = redactHeadersPreview(init?.headers);

    push({
      atMs: Date.now(),
      direction: 'req',
      method,
      url,
      bodyKeys: reqKeys,
      bodyPreview: reqPreview,
      headersPreview: Object.keys(headersPreview).length > 0 ? headersPreview : undefined,
    });

    const response = await baseFetch(input as RequestInfo, init);

    let respPreview: string | undefined;
    try {
      const clone = response.clone();
      const text = await clone.text();
      respPreview = previewBody(text, RESP_BODY_PREVIEW_MAX).preview;
    } catch {
      respPreview = '<unreadable>';
    }

    push({
      atMs: Date.now(),
      direction: 'resp',
      url,
      status: response.status,
      bodyPreview: respPreview,
    });

    return response;
  };
}
