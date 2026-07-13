/**
 * Integration-style test for the WEB→ANDROID retry fallback added s158.
 * The whole `youtubei.js/web` module is mocked out so this test file can run
 * under Node 18 (the runtime jest-expo boots) despite youtubei.js's
 * `with { type: 'json' }` ESM import assertion that Node 18 can't parse.
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

// Both Innertube.create calls (WEB singleton + ANDROID retry) route through
// this queue so a single test can prime multiple info shapes.
const createQueue: FakeInnertube[] = [];
const createCalls: Array<Record<string, unknown>> = [];

jest.mock('youtubei.js/web', () => ({
  __esModule: true,
  ClientType: { ANDROID: 'ANDROID', WEB: 'WEB' },
  Innertube: {
    create: jest.fn(async (opts: Record<string, unknown> = {}) => {
      createCalls.push(opts);
      const next = createQueue.shift();
      if (!next) throw new Error('createQueue underflow: no Innertube stub queued');
      return next;
    }),
  },
}));

import { fetchTranscript } from '../src/scrape/youtubeiClient';

// A get_transcript-400 shape: throws when called (mirrors youtubei.js masking
// the raw HTTP error as an exception).
function makeInfoWith(
  tracks: CaptionTrack[],
  { hasTranscript = false, title = 't' } = {}
): FakeInfo {
  return {
    basic_info: { title },
    captions: { caption_tracks: tracks },
    has_transcript: hasTranscript,
    getTranscript: () => {
      throw new Error('Precondition check failed.');
    },
  };
}

beforeEach(() => {
  createQueue.length = 0;
  createCalls.length = 0;
});

describe('fetchTranscript ANDROID retry (s158)', () => {
  it('retries via ANDROID Innertube when WEB timedtext returns empty body', async () => {
    // WEB Innertube: returns 1 caption_track whose URL is pot-gated (200 empty).
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/web?ei=web&sig=WEB', language_code: 'en' },
        ]),
    });
    // ANDROID Innertube: returns a track whose URL yields real srv1 XML.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/android?ei=and&sig=ANDROID', language_code: 'en' },
        ]),
    });

    const seenUrls: string[] = [];
    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      seenUrls.push(url);
      if (url.startsWith('https://yt/web')) {
        return new Response('', { status: 200 });
      }
      if (url.startsWith('https://yt/android')) {
        return new Response(
          '<transcript><text start="0" dur="2">from android</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid123', (l) => breadcrumbs.push(l), fakeFetch);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 2, text: 'from android' }]);
    expect(breadcrumbs).toContain('timedtext_empty_retry_android');
    expect(breadcrumbs).toContain('transcript_fetched');
    expect(breadcrumbs).toContain('segments_mapped');
    // First call = WEB Innertube (no client_type); second = ANDROID.
    expect(createCalls.length).toBe(2);
    expect(createCalls[0].client_type).toBeUndefined();
    expect(createCalls[1].client_type).toBe('ANDROID');
    // WEB URL was probed first, then ANDROID.
    expect(seenUrls[0]).toContain('yt/web');
    expect(seenUrls[1]).toContain('yt/android');
  });

  it('surfaces "No captions available" when ANDROID retry also returns empty', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/android?x', language_code: 'en' }]),
    });

    const fakeFetch = jest.fn(async () =>
      new Response('', { status: 200 })
    ) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await expect(
      fetchTranscript('vid456', (l) => breadcrumbs.push(l), fakeFetch)
    ).rejects.toThrow('No captions available for this video.');

    expect(breadcrumbs).toContain('timedtext_empty_retry_android');
    expect(breadcrumbs).toContain('no_captions_found');
  });

  it('does not fire ANDROID retry when WEB srv1 fallback already returns lines', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    // No second Innertube queued -- if the code tries to create one, the mock
    // throws "createQueue underflow", failing the test loudly.

    const fakeFetch = jest.fn(async () =>
      new Response(
        '<transcript><text start="0" dur="1">web-worked</text></transcript>',
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid789', (l) => breadcrumbs.push(l), fakeFetch);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 1, text: 'web-worked' }]);
    expect(breadcrumbs).not.toContain('timedtext_empty_retry_android');
    expect(createCalls.length).toBe(1);
  });
});
