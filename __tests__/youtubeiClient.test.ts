/**
 * Integration-style test for the WEB→ANDROID→IOS→TVHTML5 retry fallback
 * (ANDROID added s158, IOS+TVHTML5 added s160).
 * The whole `youtubei.js/web` module is mocked out so this test file can run
 * under Node 18 (the runtime jest-expo boots) despite youtubei.js's
 * `with { type: 'json' }` ESM import assertion that Node 18 can't parse.
 *
 * NOTE on ClientType values: the real youtubei.js v17.2.0 export
 * (`node_modules/youtubei.js/dist/src/core/Session.js`) has `IOS: "iOS"` (not
 * `"IOS"`) and no `TVHTML5` key at all -- the TV client lives at `TV`, whose
 * value is `"TVHTML5"`. The mock below mirrors those exact values/keys so
 * this test exercises the same `ClientType.TV`/`ClientType.IOS` references
 * the production code actually imports, instead of a shape that happens to
 * make the test pass but would silently break `client_type` in prod.
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

// All Innertube.create calls (WEB singleton + ANDROID/IOS/TV retries) route
// through this queue so a single test can prime multiple info shapes.
const createQueue: FakeInnertube[] = [];
const createCalls: Array<Record<string, unknown>> = [];

jest.mock('youtubei.js/web', () => ({
  __esModule: true,
  ClientType: { WEB: 'WEB', ANDROID: 'ANDROID', IOS: 'iOS', TV: 'TVHTML5' },
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

  it('falls through ANDROID (0 tracks) to IOS which returns real srv1 lines', async () => {
    // WEB: pot-gated empty body.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    // ANDROID: getInfo succeeds but caption_tracks is empty -- no base_url to try.
    createQueue.push({ getInfo: async () => makeInfoWith([]) });
    // IOS: returns a track whose srv1 body has real lines.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/ios?ei=ios&sig=IOS', language_code: 'en' }]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/ios')) {
        return new Response(
          '<transcript><text start="0" dur="2">from ios</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid-ios', (l) => breadcrumbs.push(l), fakeFetch);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 2, text: 'from ios' }]);
    expect(breadcrumbs).toContain('timedtext_empty_retry_android');
    expect(breadcrumbs).toContain('android_tracks=0');
    expect(breadcrumbs).toContain('timedtext_empty_retry_ios');
    expect(breadcrumbs).toContain('ios_tracks=1');
    expect(breadcrumbs).not.toContain('timedtext_empty_retry_tvhtml5');
    // WEB, ANDROID, IOS -- three Innertube.create calls, TV never reached.
    expect(createCalls.length).toBe(3);
    expect(createCalls[1].client_type).toBe('ANDROID');
    expect(createCalls[2].client_type).toBe('iOS');
  });

  it('falls through ANDROID (tracks but empty body) and IOS (empty) to TVHTML5', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    // ANDROID: has a track, but its srv1 body is empty (pot-gated too).
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/android?x', language_code: 'en' }]),
    });
    // IOS: no caption_tracks at all.
    createQueue.push({ getInfo: async () => makeInfoWith([]) });
    // TVHTML5: real srv1 lines.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/tv?ei=tv&sig=TV', language_code: 'en' }]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/android')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/tv')) {
        return new Response(
          '<transcript><text start="1" dur="3">from tv</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid-tv', (l) => breadcrumbs.push(l), fakeFetch);

    expect(result.lines).toEqual([{ startSec: 1, endSec: 4, text: 'from tv' }]);
    // Exact breadcrumb sequence across the 4-tier fallback, including the
    // <client>_tracks=N diagnostic markers.
    expect(breadcrumbs).toEqual([
      'starting_scrape',
      'primary_start',
      'info_fetched',
      'transcript_fetch_fallback',
      'timedtext_empty_retry_android',
      'android_tracks=1',
      'timedtext_empty_retry_ios',
      'ios_tracks=0',
      'timedtext_empty_retry_tvhtml5',
      'tvhtml5_tracks=1',
      'transcript_fetched',
      'segments_mapped',
    ]);
    expect(createCalls.length).toBe(4);
    expect(createCalls[1].client_type).toBe('ANDROID');
    expect(createCalls[2].client_type).toBe('iOS');
    expect(createCalls[3].client_type).toBe('TVHTML5');
  });

  it('surfaces "No captions available" when all 4 tiers (WEB/ANDROID/IOS/TVHTML5) return empty', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/android?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/ios?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/tv?x', language_code: 'en' }]),
    });

    const fakeFetch = jest.fn(async () =>
      new Response('', { status: 200 })
    ) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await expect(
      fetchTranscript('vid456', (l) => breadcrumbs.push(l), fakeFetch)
    ).rejects.toThrow('No captions available for this video.');

    expect(breadcrumbs).toEqual([
      'starting_scrape',
      'primary_start',
      'info_fetched',
      'transcript_fetch_fallback',
      'timedtext_empty_retry_android',
      'android_tracks=1',
      'timedtext_empty_retry_ios',
      'ios_tracks=1',
      'timedtext_empty_retry_tvhtml5',
      'tvhtml5_tracks=1',
      'no_captions_found',
    ]);
    expect(createCalls.length).toBe(4);
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

describe('<client>_error breadcrumb on pre-emit tier failure (s161)', () => {
  it('emits android_error=<ClassName> when the ANDROID tier throws before tracks are read, then still advances to IOS', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    // ANDROID tier: the session itself throws (mirrors s160 device logs where
    // no `android_tracks=N` breadcrumb ever appeared -- getInfo rejected
    // before the tracks length could be read).
    createQueue.push({
      getInfo: async () => {
        throw new TypeError('android session rejected');
      },
    });
    // IOS tier: recovers with a real track.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/ios?ei=ios&sig=IOS', language_code: 'en' }]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/ios')) {
        return new Response(
          '<transcript><text start="0" dur="2">from ios</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript(
      'vid-android-throw',
      (l) => breadcrumbs.push(l),
      fakeFetch
    );

    expect(result.lines).toEqual([{ startSec: 0, endSec: 2, text: 'from ios' }]);
    expect(breadcrumbs).toContain('timedtext_empty_retry_android');
    expect(breadcrumbs).toContain('android_error=TypeError');
    // The tracks breadcrumb for ANDROID must NOT appear -- the throw happened
    // before it could be read, which is exactly the gap this fix closes.
    expect(breadcrumbs.some((b) => b.startsWith('android_tracks='))).toBe(false);
    expect(breadcrumbs).toContain('timedtext_empty_retry_ios');
    expect(breadcrumbs).toContain('ios_tracks=1');
  });

  it('emits an _error breadcrumb per tier when ANDROID, IOS, and TVHTML5 all throw pre-emit', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () => {
        throw new TypeError('android boom');
      },
    });
    createQueue.push({
      getInfo: async () => {
        throw new RangeError('ios boom');
      },
    });
    createQueue.push({
      getInfo: async () => {
        // Non-Error throw -- errorClassName must fall back gracefully instead
        // of crashing the breadcrumb path itself.
        throw 'tv boom (not an Error instance)';
      },
    });

    const fakeFetch = jest.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await expect(
      fetchTranscript('vid-all-throw', (l) => breadcrumbs.push(l), fakeFetch)
    ).rejects.toThrow('No captions available for this video.');

    expect(breadcrumbs).toEqual([
      'starting_scrape',
      'primary_start',
      'info_fetched',
      'transcript_fetch_fallback',
      'timedtext_empty_retry_android',
      'android_error=TypeError',
      'timedtext_empty_retry_ios',
      'ios_error=RangeError',
      'timedtext_empty_retry_tvhtml5',
      'tvhtml5_error=UnknownError',
      'no_captions_found',
    ]);
  });
});
