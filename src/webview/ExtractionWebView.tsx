import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { TranscriptLine } from '../scrape/segmentMap';
import {
  EXTRACTION_INJECTED_JS,
  ScrapedSegment,
  extractionTargetUrl,
  parseExtractionMessage,
  parseTimestampToSeconds,
} from './injectedExtractionScript';
import { WebViewBreadcrumb, registerWebViewScrapeHandler } from './webviewScrapeBridge';

// Desktop UA -- YouTube's transcript panel only exists in the desktop layout
// (mock §1/§2); m.youtube.com's mobile UI has no equivalent affordance.
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function segmentsToLines(segments: ScrapedSegment[]): TranscriptLine[] {
  return segments.map((s) => {
    const startSec = parseTimestampToSeconds(s.timestamp);
    return { startSec, endSec: startSec, text: s.text };
  });
}

interface PendingRequest {
  onBreadcrumb: WebViewBreadcrumb;
  resolve: (lines: TranscriptLine[]) => void;
  reject: (err: Error) => void;
}

/**
 * Hidden, off-screen extraction WebView (s193, D19 Shape A). Mounted exactly
 * once by `App.tsx`. Registers itself with `webviewScrapeBridge` on mount so
 * `fetchTranscript`'s new top tier can request a scrape without needing
 * direct React-tree access -- the bridge is the only coupling.
 *
 * Off-screen via absolute positioning + 1x1 + opacity 0 + pointerEvents none
 * (not `display:none`, which some WebView engines pause script timers for) --
 * keeps the injected MutationObserver / retry timers running normally.
 *
 * Single-flight: only one scrape is ever in-flight at a time, matching how
 * the app's own callers use `fetchTranscript` (sequential, one video at a
 * time -- see App.tsx's "Test All 3" loop). A second request arriving while
 * one is pending overwrites `pendingRef`; the abandoned one is left to the
 * bridge-level timeout in `webviewScrapeBridge.ts`.
 */
export default function ExtractionWebView(): React.JSX.Element {
  const [source, setSource] = useState<{ uri: string } | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);

  useEffect(() => {
    const unregister = registerWebViewScrapeHandler((videoId, onBreadcrumb) => {
      return new Promise<TranscriptLine[]>((resolve, reject) => {
        pendingRef.current = { onBreadcrumb, resolve, reject };
        setSource({ uri: extractionTargetUrl(videoId) });
      });
    });
    return unregister;
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const pending = pendingRef.current;
    if (!pending) return;
    const msg = parseExtractionMessage(event.nativeEvent.data);
    if (!msg) return;

    if (msg.type === 'yt_extract_breadcrumb') {
      pending.onBreadcrumb(`webview_${msg.label}`);
      return;
    }
    if (msg.type === 'yt_extract_result') {
      pendingRef.current = null;
      pending.resolve(segmentsToLines(msg.segments));
      return;
    }
    if (msg.type === 'yt_extract_error') {
      pendingRef.current = null;
      pending.reject(new Error(msg.reason));
    }
  }, []);

  const handleLoadError = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    pending.reject(new Error('webview_load_error'));
  }, []);

  // Nothing to render until the first scrape request arrives -- avoids
  // paying for a native WebView instance before it's ever needed.
  if (!source) {
    return <View style={styles.hidden} />;
  }

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={source}
        userAgent={DESKTOP_USER_AGENT}
        injectedJavaScript={EXTRACTION_INJECTED_JS}
        onMessage={handleMessage}
        onError={handleLoadError}
        onHttpError={handleLoadError}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
