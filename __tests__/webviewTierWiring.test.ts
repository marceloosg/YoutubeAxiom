/**
 * Wiring test for the WebView-scrape NEW TOP TIER inside `fetchTranscript`
 * (s193, D19 Shape A). Mirrors `ytTranscriptProxyWiring.test.ts`'s pattern:
 * mock `youtubei.js/web` so any fall-through to the WEB tier is loudly
 * caught (createQueue underflow), and assert the webview tier runs FIRST --
 * ahead of the backend-proxy tier and the in-app youtubei.js chain.
 */

import {
  __resetWebViewScrapeBridgeForTests,
  registerWebViewScrapeHandler,
} from '../src/webview/webviewScrapeBridge';

type CaptionTrack = { base_url?: string; language_code?: string; kind?: string };

interface FakeInfo {
  basic_info?: { title?: string };
  captions?: { caption_tracks?: CaptionTrack[] };
  has_transcript?: boolean;
  getTranscript: () => Promise<unknown>;
}

interface FakeInnertube {
  getInfo: (videoId: string) => Promise<FakeInfo>;
}

const createQueue: FakeInnertube[] = [];

jest.mock('youtubei.js/web', () => ({
  __esModule: true,
  ClientType: { WEB: 'WEB', TV: 'TVHTML5', ANDROID_VR: 'ANDROID_VR' },
  Innertube: {
    create: jest.fn(async () => {
      const next = createQueue.shift();
      if (!next) {
        throw new Error('createQueue underflow: WEB tier should not run when webview scrape succeeds');
      }
      return next;
    }),
  },
}));

// No expo-constants mock -- `getBackendProxyConfig()` returns null (unconfigured),
// same as youtubeiClient.test.ts, so the proxy tier is a silent no-op and any
// success/failure observed here is attributable to the webview tier alone.

import { fetchTranscript } from '../src/scrape/youtubeiClient';

beforeEach(() => {
  createQueue.length = 0;
  __resetWebViewScrapeBridgeForTests();
});

describe('fetchTranscript webview-scrape new top tier (s193, D19 Shape A)', () => {
  it('returns webview-scraped lines without touching the backend proxy or youtubei.js at all', async () => {
    registerWebViewScrapeHandler(async (videoId) => [
      { startSec: 0, endSec: 3, text: `webview text for ${videoId}` },
    ]);

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('dQw4w9WgXcQ', (l) => breadcrumbs.push(l));

    expect(result.lines).toEqual([{ startSec: 0, endSec: 3, text: 'webview text for dQw4w9WgXcQ' }]);
    expect(breadcrumbs).toEqual(['webview_scrape_start', 'webview_scrape_ok=1']);
    expect(createQueue.length).toBe(0); // never consumed -- WEB tier never ran
  });

  it('falls through to the existing WEB chain when no extraction WebView is mounted (unregistered handler)', async () => {
    createQueue.push({
      getInfo: async () => ({
        basic_info: { title: 'fallback title' },
        captions: { caption_tracks: [{ base_url: 'https://yt/web?x', language_code: 'en' }] },
        has_transcript: true,
        getTranscript: () => {
          throw new Error('Precondition check failed.');
        },
      }),
    });

    const fetchMock = jest.fn(async () =>
      new Response(
        '<transcript><text start="0" dur="1">from web fallback</text></transcript>',
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid-no-webview', (l) => breadcrumbs.push(l), fetchMock);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 1, text: 'from web fallback' }]);
    // No webview_scrape_* breadcrumb at all -- silent skip, matching the
    // unconfigured-proxy contract in ytTranscriptProxy.ts.
    expect(breadcrumbs.some((b) => b.startsWith('webview_scrape'))).toBe(false);
    expect(breadcrumbs).toEqual(
      expect.arrayContaining(['starting_scrape', 'primary_start', 'info_fetched'])
    );
  });

  it('falls through to the existing WEB chain when the webview scrape fails (empty result)', async () => {
    registerWebViewScrapeHandler(async () => []);

    createQueue.push({
      getInfo: async () => ({
        basic_info: { title: 'fallback title' },
        captions: { caption_tracks: [{ base_url: 'https://yt/web?x', language_code: 'en' }] },
        has_transcript: true,
        getTranscript: () => {
          throw new Error('Precondition check failed.');
        },
      }),
    });

    const fetchMock = jest.fn(async () =>
      new Response(
        '<transcript><text start="0" dur="1">from web fallback</text></transcript>',
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid-webview-fail', (l) => breadcrumbs.push(l), fetchMock);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 1, text: 'from web fallback' }]);
    expect(breadcrumbs).toEqual(
      expect.arrayContaining(['webview_scrape_start', 'webview_scrape_fail=empty_lines'])
    );
  });
});
