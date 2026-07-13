/**
 * Integration-style test for the WEB→TVHTML5→ANDROID_VR retry fallback
 * (ANDROID+IOS added s158/s160, dropped s162 Path A in favor of TVHTML5
 * first + ANDROID_VR -- neither requires a pot per the yt-dlp PO Token Guide).
 * The whole `youtubei.js/web` module is mocked out so this test file can run
 * under Node 18 (the runtime jest-expo boots) despite youtubei.js's
 * `with { type: 'json' }` ESM import assertion that Node 18 can't parse.
 *
 * NOTE on ClientType values: the real youtubei.js v17.2.0 export
 * (`node_modules/youtubei.js/dist/src/core/Session.js`) has no `TVHTML5` key
 * at all -- the TV client lives at `TV`, whose value is `"TVHTML5"`.
 * `ANDROID_VR` is a real key whose value is `"ANDROID_VR"` (verified STEP 0,
 * s162). The mock below mirrors those exact values/keys so this test
 * exercises the same `ClientType.TV`/`ClientType.ANDROID_VR` references the
 * production code actually imports, instead of a shape that happens to make
 * the test pass but would silently break `client_type` in prod.
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

// All Innertube.create calls (WEB singleton + TV/ANDROID_VR retries) route
// through this queue so a single test can prime multiple info shapes.
const createQueue: FakeInnertube[] = [];
const createCalls: Array<Record<string, unknown>> = [];

jest.mock('youtubei.js/web', () => ({
  __esModule: true,
  ClientType: { WEB: 'WEB', TV: 'TVHTML5', ANDROID_VR: 'ANDROID_VR' },
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

describe('fetchTranscript retrieve_player (s162, WEB restored v1.0.10)', () => {
  it('uses retrieve_player: true for the primary WEB Innertube', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith(
          [{ base_url: 'https://yt/web?x', language_code: 'en' }],
          { hasTranscript: true }
        ),
    });

    const fakeFetch = jest.fn(async () =>
      new Response(
        '<transcript><text start="0" dur="1">web-worked</text></transcript>',
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    await fetchTranscript('vid-retrieve-player', () => {}, fakeFetch);

    // v1.0.10: WEB primary restores retrieve_player:true -- retrieve_player:false
    // on WEB nullified info.captions.caption_tracks, breaking the fallback
    // trigger (v1.0.9 device log msg 7140).
    expect(createCalls[0].retrieve_player).toBe(true);
  });

  it('uses retrieve_player: false for TVHTML5 retry Innertube', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/tv?ei=tv&sig=TV', language_code: 'en' }]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/tv')) {
        return new Response(
          '<transcript><text start="1" dur="3">from tv</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await fetchTranscript('vid-tv-retrieve-player', () => {}, fakeFetch);

    // createCalls[0] = WEB singleton, createCalls[1] = TVHTML5 retry.
    expect(createCalls[1].client_type).toBe('TVHTML5');
    expect(createCalls[1].retrieve_player).toBe(false);
  });
});

describe('fetchTranscript TVHTML5/ANDROID_VR retry (s162 Path A)', () => {
  it('retries via TVHTML5 Innertube when WEB timedtext returns empty body', async () => {
    // WEB Innertube: returns 1 caption_track whose URL is pot-gated (200 empty).
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/web?ei=web&sig=WEB', language_code: 'en' },
        ]),
    });
    // TVHTML5 Innertube: returns a track whose URL yields real srv1 XML.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/tv?ei=tv&sig=TV', language_code: 'en' },
        ]),
    });

    const seenUrls: string[] = [];
    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      seenUrls.push(url);
      if (url.startsWith('https://yt/web')) {
        return new Response('', { status: 200 });
      }
      if (url.startsWith('https://yt/tv')) {
        return new Response(
          '<transcript><text start="0" dur="2">from tv</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid123', (l) => breadcrumbs.push(l), fakeFetch);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 2, text: 'from tv' }]);
    expect(breadcrumbs).toContain('timedtext_empty_retry_tvhtml5');
    expect(breadcrumbs).toContain('transcript_fetched');
    expect(breadcrumbs).toContain('segments_mapped');
    // First call = WEB Innertube (no client_type); second = TVHTML5.
    expect(createCalls.length).toBe(2);
    expect(createCalls[0].client_type).toBeUndefined();
    expect(createCalls[1].client_type).toBe('TVHTML5');
    // WEB URL was probed first, then TVHTML5.
    expect(seenUrls[0]).toContain('yt/web');
    expect(seenUrls[1]).toContain('yt/tv');
  });

  it('falls through TVHTML5 (0 tracks) to ANDROID_VR which returns real srv1 lines', async () => {
    // WEB: pot-gated empty body.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    // TVHTML5: getInfo succeeds but caption_tracks is empty -- no base_url to try.
    createQueue.push({ getInfo: async () => makeInfoWith([]) });
    // ANDROID_VR: returns a track whose srv1 body has real lines.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/android_vr?ei=avr&sig=AVR', language_code: 'en' },
        ]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/android_vr')) {
        return new Response(
          '<transcript><text start="0" dur="2">from android vr</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript('vid-android-vr', (l) => breadcrumbs.push(l), fakeFetch);

    expect(result.lines).toEqual([{ startSec: 0, endSec: 2, text: 'from android vr' }]);
    expect(breadcrumbs).toContain('timedtext_empty_retry_tvhtml5');
    expect(breadcrumbs).toContain('tvhtml5_tracks=0');
    expect(breadcrumbs).toContain('timedtext_empty_retry_android_vr');
    expect(breadcrumbs).toContain('android_vr_tracks=1');
    // WEB, TVHTML5, ANDROID_VR -- three Innertube.create calls.
    expect(createCalls.length).toBe(3);
    expect(createCalls[1].client_type).toBe('TVHTML5');
    expect(createCalls[2].client_type).toBe('ANDROID_VR');
  });

  it('surfaces "No captions available" when all 3 tiers (WEB/TVHTML5/ANDROID_VR) return empty', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/tv?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/android_vr?x', language_code: 'en' }]),
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
      'timedtext_empty_retry_tvhtml5',
      'tvhtml5_tracks=1',
      'timedtext_empty_retry_android_vr',
      'android_vr_tracks=1',
      'no_captions_found',
    ]);
    expect(createCalls.length).toBe(3);
  });

  it('does not fire TVHTML5 retry when WEB srv1 fallback already returns lines', async () => {
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
    expect(breadcrumbs).not.toContain('timedtext_empty_retry_tvhtml5');
    expect(createCalls.length).toBe(1);
  });
});

describe('<client>_error breadcrumb on pre-emit tier failure (s161, retargeted s162)', () => {
  it('emits tvhtml5_error=<ClassName> when the TVHTML5 tier throws before tracks are read, then still advances to ANDROID_VR', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    // TVHTML5 tier: the session itself throws (mirrors s160 device logs where
    // no `tvhtml5_tracks=N` breadcrumb ever appeared -- getInfo rejected
    // before the tracks length could be read).
    createQueue.push({
      getInfo: async () => {
        throw new TypeError('tvhtml5 session rejected');
      },
    });
    // ANDROID_VR tier: recovers with a real track.
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/android_vr?ei=avr&sig=AVR', language_code: 'en' },
        ]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/android_vr')) {
        return new Response(
          '<transcript><text start="0" dur="2">from android vr</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscript(
      'vid-tvhtml5-throw',
      (l) => breadcrumbs.push(l),
      fakeFetch
    );

    expect(result.lines).toEqual([{ startSec: 0, endSec: 2, text: 'from android vr' }]);
    expect(breadcrumbs).toContain('timedtext_empty_retry_tvhtml5');
    expect(breadcrumbs).toContain('tvhtml5_error=TypeError:tvhtml5 session rejected');
    // The tracks breadcrumb for TVHTML5 must NOT appear -- the throw happened
    // before it could be read, which is exactly the gap this fix closes.
    expect(breadcrumbs.some((b) => b.startsWith('tvhtml5_tracks='))).toBe(false);
    expect(breadcrumbs).toContain('timedtext_empty_retry_android_vr');
    expect(breadcrumbs).toContain('android_vr_tracks=1');
  });

  it('emits an _error breadcrumb per tier when TVHTML5 and ANDROID_VR both throw pre-emit', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () => {
        throw new TypeError('tvhtml5 boom');
      },
    });
    createQueue.push({
      getInfo: async () => {
        // Non-Error throw -- errorClassName must fall back gracefully instead
        // of crashing the breadcrumb path itself.
        throw 'android_vr boom (not an Error instance)';
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
      'timedtext_empty_retry_tvhtml5',
      'tvhtml5_error=TypeError:tvhtml5 boom',
      'timedtext_empty_retry_android_vr',
      'android_vr_error=UnknownError',
      'no_captions_found',
    ]);
  });

  it('truncates the error message to 100 chars after the class name', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () => {
        throw new TypeError('a'.repeat(200));
      },
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/android_vr?ei=avr&sig=AVR', language_code: 'en' },
        ]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/android_vr')) {
        return new Response(
          '<transcript><text start="0" dur="2">from android vr</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await fetchTranscript('vid-tvhtml5-long-message', (l) => breadcrumbs.push(l), fakeFetch);

    const errorBreadcrumb = breadcrumbs.find((b) => b.startsWith('tvhtml5_error='));
    expect(errorBreadcrumb).toBe(`tvhtml5_error=TypeError:${'a'.repeat(100)}`);
  });

  it('strips newlines from the error message into a single-line breadcrumb', async () => {
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([{ base_url: 'https://yt/web?x', language_code: 'en' }]),
    });
    createQueue.push({
      getInfo: async () => {
        throw new TypeError('line1\nline2');
      },
    });
    createQueue.push({
      getInfo: async () =>
        makeInfoWith([
          { base_url: 'https://yt/android_vr?ei=avr&sig=AVR', language_code: 'en' },
        ]),
    });

    const fakeFetch = jest.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://yt/web')) return new Response('', { status: 200 });
      if (url.startsWith('https://yt/android_vr')) {
        return new Response(
          '<transcript><text start="0" dur="2">from android vr</text></transcript>',
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    await fetchTranscript('vid-tvhtml5-newline-message', (l) => breadcrumbs.push(l), fakeFetch);

    expect(breadcrumbs).toContain('tvhtml5_error=TypeError:line1 line2');
  });
});
