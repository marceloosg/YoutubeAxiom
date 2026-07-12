import { useCallback, useState } from 'react';

/**
 * Shareable network log for debugging youtubei.js + backend POST payloads.
 * Mirrors the shape of `useBreadcrumbLog` -- entries accumulate, and the hook
 * returns `formattedLines` ready for on-screen render or `Share.share`.
 *
 * Context: Marcelo hit a `get_transcript` 400 (2026-07-12 msg 6661) with only
 * stage breadcrumbs visible. This closes the payload-visibility gap.
 */

export interface NetworkLogEntry {
  atMs: number;
  direction: 'req' | 'resp';
  method?: string;
  url: string;
  status?: number;
  bodyKeys?: string[];
  bodyPreview?: string;
  headersPreview?: Record<string, string>;
}

function formatTime(atMs: number): string {
  const d = new Date(atMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Format one entry as a single line.
 * Req  : `[HH:MM:SS] -> POST https://... keys=[a,b,c] body="..."`
 * Resp : `[HH:MM:SS] <- 400 https://... body="..."`
 */
function formatHeaders(headers?: Record<string, string>): string {
  if (!headers) return '';
  const keys = Object.keys(headers);
  if (keys.length === 0) return '';
  const pairs = keys.map((k) => `${k}=${headers[k]}`).join(', ');
  return ` headers={${pairs}}`;
}

export function formatNetworkEntry(entry: NetworkLogEntry): string {
  const time = formatTime(entry.atMs);
  if (entry.direction === 'req') {
    const method = entry.method ?? 'GET';
    const keys =
      entry.bodyKeys && entry.bodyKeys.length > 0
        ? ` keys=[${entry.bodyKeys.join(',')}]`
        : '';
    const headers = formatHeaders(entry.headersPreview);
    const body =
      entry.bodyPreview !== undefined ? ` body=${JSON.stringify(entry.bodyPreview)}` : '';
    return `[${time}] -> ${method} ${entry.url}${headers}${keys}${body}`;
  }
  const status = entry.status !== undefined ? String(entry.status) : '???';
  const body =
    entry.bodyPreview !== undefined ? ` body=${JSON.stringify(entry.bodyPreview)}` : '';
  return `[${time}] <- ${status} ${entry.url}${body}`;
}

export interface UseNetworkLog {
  entries: NetworkLogEntry[];
  formattedLines: string[];
  push: (entry: NetworkLogEntry) => void;
  reset: () => void;
}

/** React hook: accumulate network log entries for on-screen display + Share. */
export function useNetworkLog(): UseNetworkLog {
  const [entries, setEntries] = useState<NetworkLogEntry[]>([]);

  const push = useCallback((entry: NetworkLogEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  const reset = useCallback(() => setEntries([]), []);

  return {
    entries,
    formattedLines: entries.map(formatNetworkEntry),
    push,
    reset,
  };
}
