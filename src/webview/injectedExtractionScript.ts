/**
 * Injected-JS payload + message protocol for the hidden extraction WebView
 * (s193, D19 Shape A). Split out from `ExtractionWebView.tsx` so the pure
 * parsing/formatting helpers are unit-testable without pulling in
 * `react-native-webview` (matches the segmentMap.ts / youtubeiClient.ts
 * split already used in this repo).
 *
 * Protocol: the injected script `window.ReactNativeWebView.postMessage`s
 * JSON-encoded `ExtractionMessage` objects. Zero or more `breadcrumb`
 * messages may arrive before the single terminal `result` or `error`
 * message -- `ExtractionWebView.tsx` forwards breadcrumbs live and resolves
 * its pending promise on the terminal message.
 */

export interface ScrapedSegment {
  text: string;
  /** Raw `mm:ss` / `h:mm:ss` timestamp text as rendered by YouTube, if present. */
  timestamp?: string;
}

export type ExtractionMessage =
  | { type: 'yt_extract_result'; segments: ScrapedSegment[] }
  | { type: 'yt_extract_error'; reason: string }
  | { type: 'yt_extract_breadcrumb'; label: string };

/**
 * Parses a raw `WebViewMessageEvent.nativeEvent.data` string into a typed
 * `ExtractionMessage`. Returns `null` for anything that isn't valid JSON or
 * doesn't match the expected shape -- defensive, since the message channel
 * is fed by page JS running against a third-party site we don't control.
 */
export function parseExtractionMessage(raw: string): ExtractionMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.type === 'yt_extract_result' && Array.isArray(obj.segments)) {
    const segments: ScrapedSegment[] = [];
    for (const s of obj.segments) {
      if (s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string') {
        const rec = s as Record<string, unknown>;
        segments.push({
          text: rec.text as string,
          timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : undefined,
        });
      }
    }
    return { type: 'yt_extract_result', segments };
  }
  if (obj.type === 'yt_extract_error' && typeof obj.reason === 'string') {
    return { type: 'yt_extract_error', reason: obj.reason };
  }
  if (obj.type === 'yt_extract_breadcrumb' && typeof obj.label === 'string') {
    return { type: 'yt_extract_breadcrumb', label: obj.label };
  }
  return null;
}

/**
 * Parses a rendered YouTube transcript timestamp (`"0:05"`, `"12:03"`,
 * `"1:02:03"`) into whole seconds. Returns 0 for anything unparseable rather
 * than throwing -- a timestamp miss shouldn't drop the transcript text.
 */
export function parseTimestampToSeconds(ts: string | undefined): number {
  if (!ts) return 0;
  const parts = ts.trim().split(':').map((p) => Number(p));
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * Builds the video URL the hidden extraction WebView navigates to.
 * `www.youtube.com` (not `m.youtube.com`) -- the mobile UI has no transcript
 * panel (mock §1 note); the desktop UA (set on the WebView `userAgent` prop,
 * not here) is what makes the desktop layout render on Android.
 */
export function extractionTargetUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Injected into the hidden desktop-UA extraction WebView.
 *
 * Resilient-selector strategy (deliverable item 7): every DOM lookup tries a
 * short list of alternative selectors before giving up, and every stage that
 * fails to find its target posts a `yt_extract_breadcrumb` with a
 * `dom_shape_shift:<stage>` label BEFORE falling through to the terminal
 * error -- so a future YouTube UI change shows up as a diagnosable breadcrumb
 * in the on-device test-suite log instead of a silent empty result (mock Q1
 * risk). This is a best-effort DOM scrape written against YouTube's current
 * (2026) desktop transcript-panel markup; Q1 (does it actually render+scrape
 * off-screen on Android) is NOT verifiable without a device and is called out
 * as the load-bearing open risk in the PR.
 */
export const EXTRACTION_INJECTED_JS = `
(function () {
  function post(msg) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (e) {}
  }
  function crumb(label) {
    post({ type: 'yt_extract_breadcrumb', label: label });
  }
  function fail(reason) {
    post({ type: 'yt_extract_error', reason: String(reason).slice(0, 200) });
  }

  function queryFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function findButtonByText(re) {
    var candidates = document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (re.test(label)) return el;
    }
    return null;
  }

  function dismissConsentIfPresent() {
    // YouTube's EU/UK consent interstitial replaces the whole page with a
    // consent.youtube.com form -- "Accept all" / "Reject all" buttons.
    var consentBtn = findButtonByText(/^(accept all|i agree|accept the use of cookies)/i);
    if (consentBtn) {
      crumb('consent_dismissed');
      consentBtn.click();
      return true;
    }
    return false;
  }

  function openTranscriptPanel(cb) {
    // Step 1: expand the description if collapsed (transcript button lives
    // inside the expanded description on most layouts).
    var expandBtn = queryFirst([
      'tp-yt-paper-button#expand',
      '#description-inline-expander tp-yt-paper-button',
      '#expand',
    ]);
    if (expandBtn) {
      crumb('description_expanded');
      expandBtn.click();
    } else {
      crumb('dom_shape_shift:expand_button_missing');
    }

    // Step 2: click "Show transcript". Retry briefly -- the button often
    // isn't in the DOM until the description finishes expanding.
    var attempts = 0;
    var maxAttempts = 20;
    var timer = setInterval(function () {
      attempts++;
      var transcriptBtn =
        queryFirst(['[aria-label="Show transcript"]', 'button[aria-label*="transcript" i]']) ||
        findButtonByText(/show transcript/i);
      if (transcriptBtn) {
        clearInterval(timer);
        crumb('transcript_button_clicked');
        transcriptBtn.click();
        cb(true);
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        crumb('dom_shape_shift:transcript_button_missing');
        cb(false);
      }
    }, 250);
  }

  function waitForSegments(cb) {
    var found = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (found.length > 0) {
      cb(found);
      return;
    }
    var settled = false;
    var observer = new MutationObserver(function () {
      var nodes = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (nodes.length > 0 && !settled) {
        settled = true;
        observer.disconnect();
        cb(nodes);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      if (settled) return;
      settled = true;
      observer.disconnect();
      var nodes = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (nodes.length > 0) {
        cb(nodes);
      } else {
        crumb('dom_shape_shift:segment_renderer_missing');
        cb(nodes);
      }
    }, 15000);
  }

  function scrapeSegments(nodes) {
    var segments = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var textEl = node.querySelector('.segment-text, [class*="segment-text"]');
      var tsEl = node.querySelector('.segment-timestamp, [class*="segment-timestamp"]');
      var text = textEl ? textEl.textContent.trim() : '';
      if (!text) continue;
      segments.push({ text: text, timestamp: tsEl ? tsEl.textContent.trim() : undefined });
    }
    return segments;
  }

  function run() {
    dismissConsentIfPresent();
    // Re-check shortly after in case the consent form was still rendering.
    setTimeout(function () {
      dismissConsentIfPresent();
      openTranscriptPanel(function (opened) {
        if (!opened) {
          fail('transcript_panel_unreachable');
          return;
        }
        waitForSegments(function (nodes) {
          var segments = scrapeSegments(nodes);
          if (segments.length === 0) {
            fail('no_segments_scraped');
            return;
          }
          post({ type: 'yt_extract_result', segments: segments });
        });
      });
    }, 800);
  }

  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run);
  }
})();
true;
`;
