import { useCallback, useState } from 'react';

/**
 * Log-over-progress-bar UX (mirrors Kotlin ScrapeLogFile + BreadcrumbFormat).
 * Rather than a spinner with no detail, the UI shows a scrolling list of
 * timestamped stage labels emitted during the scrape/upload pipeline.
 */

export interface BreadcrumbEntry {
  label: string;
  atMs: number;
}

/** `[HH:MM:SS] label` -- matches the Kotlin BreadcrumbFormat text shape. */
export function formatBreadcrumb(entry: BreadcrumbEntry): string {
  const d = new Date(entry.atMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}] ${entry.label}`;
}

export interface UseBreadcrumbLog {
  entries: BreadcrumbEntry[];
  formattedLines: string[];
  push: (label: string) => void;
  reset: () => void;
}

/** React hook: accumulate breadcrumb entries for on-screen display + backend POST. */
export function useBreadcrumbLog(): UseBreadcrumbLog {
  const [entries, setEntries] = useState<BreadcrumbEntry[]>([]);

  const push = useCallback((label: string) => {
    setEntries((prev) => [...prev, { label, atMs: Date.now() }]);
  }, []);

  const reset = useCallback(() => setEntries([]), []);

  return {
    entries,
    formattedLines: entries.map(formatBreadcrumb),
    push,
    reset,
  };
}
