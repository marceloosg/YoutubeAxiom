/**
 * Handler-registry bridge between `fetchTranscript` (a plain async function,
 * no React tree access) and the hidden `ExtractionWebView` component that
 * `App.tsx` mounts once (s193, D19 Shape A). Kept dependency-free of
 * `react-native-webview` so it can be imported by `youtubeiClient.ts` and
 * unit-tested without pulling in native-module code (matches the existing
 * pure/component split in this repo, e.g. segmentMap.ts vs
 * youtubeiClient.ts).
 *
 * Contract mirrors `fetchTranscriptViaProxy` (src/backend/ytTranscriptProxy.ts):
 * this module NEVER throws. When no extraction WebView is mounted (e.g. Jest
 * tests, or the app hasn't finished its first render yet) `requestWebViewScrape`
 * resolves `null` immediately with **zero breadcrumbs** -- identical to how
 * the backend-proxy tier silently no-ops when unconfigured, so builds/tests
 * that never touch this tier see no behavior change.
 */

import { TranscriptLine } from '../scrape/segmentMap';

export type WebViewBreadcrumb = (label: string) => void;

/**
 * Registered by `ExtractionWebView` once it's mounted and ready to accept
 * scrape requests. Takes the videoId plus a breadcrumb sink so interim
 * diagnostics from the injected script (consent dismissed, DOM-shape-shift
 * warnings) surface through the same breadcrumb log the rest of the app
 * uses, not just the terminal pass/fail.
 */
export type WebViewScrapeHandler = (
  videoId: string,
  onBreadcrumb: WebViewBreadcrumb
) => Promise<TranscriptLine[]>;

let activeHandler: WebViewScrapeHandler | null = null;

/** Registers the active extraction handler; returns an unregister function for unmount cleanup. */
export function registerWebViewScrapeHandler(handler: WebViewScrapeHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function isWebViewScrapeHandlerRegistered(): boolean {
  return activeHandler !== null;
}

const DEFAULT_TIMEOUT_MS = 25000;

/**
 * NEW TOP TIER (s193, D19 Shape A) -- called from `fetchTranscript` before
 * the existing backend-proxy / youtubei.js chain. Attempts extraction via the
 * on-device logged-in WebView; resolves `null` on ANY failure (unregistered,
 * timeout, handler threw, empty result) so the caller falls through exactly
 * like every other tier in this file's fallback chain.
 */
export async function requestWebViewScrape(
  videoId: string,
  onBreadcrumb: WebViewBreadcrumb = () => {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<TranscriptLine[] | null> {
  if (!activeHandler) return null;

  onBreadcrumb('webview_scrape_start');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lines = await Promise.race([
      activeHandler(videoId, onBreadcrumb),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    if (!lines || lines.length === 0) {
      onBreadcrumb('webview_scrape_fail=empty_lines');
      return null;
    }
    onBreadcrumb(`webview_scrape_ok=${lines.length}`);
    return lines;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onBreadcrumb(`webview_scrape_fail=${message.slice(0, 80)}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test-only reset -- keeps unit tests hermetic across files/`beforeEach`. */
export function __resetWebViewScrapeBridgeForTests(): void {
  activeHandler = null;
}
