/**
 * Wiring test for the Path K backend-proxy FIRST TIER inside `fetchTranscript`
 * (s176-follow). Separate file from `youtubeiClient.test.ts` because this one
 * needs `expo-constants` mocked to exercise the configured-proxy branch --
 * `youtubeiClient.test.ts` deliberately leaves it unmocked (default `{}`) to
 * prove the unconfigured/silent-skip path leaves existing behavior untouched.
 */

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
      if (!next) throw new Error('createQueue underflow: WEB tier should not run when proxy succeeds');
      return next;
    }),
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        ytTranscriptBaseUrl: 'http://100.27.246.241:8737',
        ytTranscriptSecret: 'yt-transcript-test-secret',
      },
    },
  },
}));

import { fetchTranscript } from '../src/scrape/youtubeiClient';

beforeEach(() => {
  createQueue.length = 0;
});

describe('fetchTranscript backend-proxy first tier (s176-follow)', () => {
  it('returns proxy-sourced lines (parsed from srv1_xml) without touching youtubei.js at all', async () => {
    const proxyFetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        video_id: 'dQw4w9WgXcQ',
        source: 'auto',
        srv1_xml:
          '<transcript><text start="0.5" dur="3.2">never gonna give you up</text></transcript>',
        text: 'never gonna give you up',
        byte_len: 92,
      }),
    })) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript(
      'dQw4w9WgXcQ',
      (l) => breadcrumbs.push(l),
      proxyFetch
    );

    expect(result.lines).toEqual([{ startSec: 0.5, endSec: 3.7, text: 'never gonna give you up' }]);
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatch(/^backend_proxy_ok elapsed_ms=\d+$/);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    const [url] = (proxyFetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://100.27.246.241:8737/transcript');
  });

  it('falls through to the in-app WEB tier when the proxy returns 401', async () => {
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

    const fetchMock = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('8737/transcript')) {
        return { status: 401, ok: false, json: async () => ({ error: 'unauthorized' }) } as unknown as Response;
      }
      return new Response(
        '<transcript><text start="0" dur="1">from web fallback</text></transcript>',
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid-401-fallback', (l) => breadcrumbs.push(l), fetchMock);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 1, text: 'from web fallback' }]);
    expect(breadcrumbs.some((b) => /^backend_proxy_fail=unauthorized elapsed_ms=\d+$/.test(b))).toBe(
      true
    );
    expect(breadcrumbs).toEqual(
      expect.arrayContaining(['proxy_fallback_entered=unauthorized', 'starting_scrape'])
    );
  });

  it('emits proxy_fallback_entered exactly once, right after the proxy-fail breadcrumb, and before the in-app chain starts', async () => {
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

    const fetchMock = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('8737/transcript')) {
        return { status: 401, ok: false, json: async () => ({ error: 'unauthorized' }) } as unknown as Response;
      }
      return new Response(
        '<transcript><text start="0" dur="1">from web fallback</text></transcript>',
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await fetchTranscript('vid-401-fallback-order', (l) => breadcrumbs.push(l), fetchMock);

    const fallbackEnteredCount = breadcrumbs.filter((b) => b === 'proxy_fallback_entered=unauthorized')
      .length;
    expect(fallbackEnteredCount).toBe(1);

    const failIdx = breadcrumbs.findIndex((b) => b.startsWith('backend_proxy_fail=unauthorized'));
    const fallbackIdx = breadcrumbs.indexOf('proxy_fallback_entered=unauthorized');
    const startingScrapeIdx = breadcrumbs.indexOf('starting_scrape');
    expect(failIdx).toBeGreaterThanOrEqual(0);
    expect(fallbackIdx).toBeGreaterThan(failIdx);
    expect(startingScrapeIdx).toBeGreaterThan(fallbackIdx);
  });

  it('does NOT emit proxy_fallback_entered when the proxy tier succeeds', async () => {
    const proxyFetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        video_id: 'dQw4w9WgXcQ',
        source: 'auto',
        text: 'never gonna give you up',
        byte_len: 92,
      }),
    })) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await fetchTranscript('dQw4w9WgXcQ', (l) => breadcrumbs.push(l), proxyFetch);

    expect(breadcrumbs.some((b) => b.startsWith('proxy_fallback_entered='))).toBe(false);
  });
});
