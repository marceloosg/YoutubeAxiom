import {
  fetchTimedtextLines,
  mapSegments,
  parseTimedtextSrv1,
  pickCaptionTrack,
} from '../src/scrape/segmentMap';

describe('mapSegments', () => {
  it('maps ms fields to seconds and extracts snippet text', () => {
    const raw = [
      { type: 'TranscriptSegment', start_ms: '1000', end_ms: '4500', snippet: { text: 'Hello there' } },
      { type: 'TranscriptSegment', start_ms: '4500', end_ms: '8000', snippet: { text: 'general kenobi' } },
    ];

    expect(mapSegments(raw)).toEqual([
      { startSec: 1, endSec: 4.5, text: 'Hello there' },
      { startSec: 4.5, endSec: 8, text: 'general kenobi' },
    ]);
  });

  it('skips TranscriptSectionHeader entries (chapter markers)', () => {
    const raw = [
      { type: 'TranscriptSectionHeader' },
      { type: 'TranscriptSegment', start_ms: '0', end_ms: '2000', snippet: { text: 'intro' } },
    ];

    expect(mapSegments(raw)).toEqual([{ startSec: 0, endSec: 2, text: 'intro' }]);
  });

  it('falls back to snippet.toString() when .text is absent', () => {
    const raw = [
      {
        type: 'TranscriptSegment',
        start_ms: '0',
        end_ms: '1000',
        snippet: { toString: () => 'fallback text' },
      },
    ];

    expect(mapSegments(raw)).toEqual([{ startSec: 0, endSec: 1, text: 'fallback text' }]);
  });

  it('returns an empty array for no segments', () => {
    expect(mapSegments([])).toEqual([]);
  });

  it('trims whitespace from snippet text', () => {
    const raw = [
      { type: 'TranscriptSegment', start_ms: '0', end_ms: '1000', snippet: { text: '  padded  ' } },
    ];
    expect(mapSegments(raw)).toEqual([{ startSec: 0, endSec: 1, text: 'padded' }]);
  });
});

describe('parseTimedtextSrv1', () => {
  it('parses basic 2-line srv1 XML into TranscriptLine[]', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8" ?>' +
      '<transcript>' +
      '<text start="0.5" dur="3.2">Hello there</text>' +
      '<text start="3.7" dur="2.1">general kenobi</text>' +
      '</transcript>';

    expect(parseTimedtextSrv1(xml)).toEqual([
      { startSec: 0.5, endSec: 3.7, text: 'Hello there' },
      { startSec: 3.7, endSec: 5.8, text: 'general kenobi' },
    ]);
  });

  it('decodes HTML entities (&amp;, &#39;, &quot;, &#x27;)', () => {
    const xml =
      '<transcript>' +
      '<text start="0" dur="1">A &amp; B</text>' +
      '<text start="1" dur="1">it&#39;s fine</text>' +
      '<text start="2" dur="1">&quot;quoted&quot;</text>' +
      '<text start="3" dur="1">hex &#x27;quote&#x27;</text>' +
      '</transcript>';

    expect(parseTimedtextSrv1(xml)).toEqual([
      { startSec: 0, endSec: 1, text: 'A & B' },
      { startSec: 1, endSec: 2, text: "it's fine" },
      { startSec: 2, endSec: 3, text: '"quoted"' },
      { startSec: 3, endSec: 4, text: "hex 'quote'" },
    ]);
  });

  it('handles multi-line text content inside <text>', () => {
    const xml =
      '<transcript>' +
      '<text start="0" dur="2">line one\nline two</text>' +
      '</transcript>';

    expect(parseTimedtextSrv1(xml)).toEqual([
      { startSec: 0, endSec: 2, text: 'line one\nline two' },
    ]);
  });

  it('returns empty array for empty <transcript></transcript>', () => {
    expect(parseTimedtextSrv1('<transcript></transcript>')).toEqual([]);
  });

  it('strips residual/embedded HTML tags like <font> after entity decode', () => {
    const xml =
      '<transcript>' +
      // Encoded font tag: decoded to <font>...</font>, then stripped.
      '<text start="0" dur="2">&lt;font color=&quot;red&quot;&gt;important&lt;/font&gt; note</text>' +
      // Also handle literal (unescaped) embedded tags.
      '<text start="2" dur="1">plain <i>italic</i> text</text>' +
      '</transcript>';

    expect(parseTimedtextSrv1(xml)).toEqual([
      { startSec: 0, endSec: 2, text: 'important note' },
      { startSec: 2, endSec: 3, text: 'plain italic text' },
    ]);
  });

  it('skips <text> entries whose content decodes to empty', () => {
    const xml =
      '<transcript>' +
      '<text start="0" dur="1">   </text>' +
      '<text start="1" dur="1">real</text>' +
      '</transcript>';

    expect(parseTimedtextSrv1(xml)).toEqual([
      { startSec: 1, endSec: 2, text: 'real' },
    ]);
  });
});

describe('pickCaptionTrack', () => {
  it('prefers manual English over ASR English', () => {
    const tracks = [
      { language_code: 'en', kind: 'asr', base_url: 'https://yt/asr' },
      { language_code: 'en', base_url: 'https://yt/manual' },
      { language_code: 'es', base_url: 'https://yt/es' },
    ];
    expect(pickCaptionTrack(tracks)?.base_url).toBe('https://yt/manual');
  });

  it('falls back to ASR English when no manual English exists', () => {
    const tracks = [
      { language_code: 'es', base_url: 'https://yt/es' },
      { language_code: 'en', kind: 'asr', base_url: 'https://yt/asr' },
    ];
    expect(pickCaptionTrack(tracks)?.base_url).toBe('https://yt/asr');
  });

  it('falls back to first track when no English exists', () => {
    const tracks = [
      { language_code: 'pt', base_url: 'https://yt/pt' },
      { language_code: 'es', base_url: 'https://yt/es' },
    ];
    expect(pickCaptionTrack(tracks)?.base_url).toBe('https://yt/pt');
  });

  it('returns undefined for an empty list', () => {
    expect(pickCaptionTrack([])).toBeUndefined();
  });
});

describe('fetchTimedtextLines', () => {
  it('appends &fmt=srv1 when the base_url has no fmt param', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return new Response('<transcript></transcript>', { status: 200 });
    }) as unknown as typeof fetch;

    await fetchTimedtextLines('https://yt/api/timedtext?v=abc', fetchImpl);
    expect(seen[0]).toBe('https://yt/api/timedtext?v=abc&fmt=srv1');
  });

  it('leaves base_url alone when fmt= is already present', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return new Response('<transcript></transcript>', { status: 200 });
    }) as unknown as typeof fetch;

    await fetchTimedtextLines('https://yt/api/timedtext?v=abc&fmt=json3', fetchImpl);
    expect(seen[0]).toBe('https://yt/api/timedtext?v=abc&fmt=json3');
  });

  it('returns parsed TranscriptLine[] on a well-formed srv1 body', async () => {
    const xml =
      '<transcript>' +
      '<text start="0" dur="2">hi</text>' +
      '<text start="2" dur="1">there</text>' +
      '</transcript>';
    const fetchImpl = (async () =>
      new Response(xml, { status: 200 })) as unknown as typeof fetch;

    const lines = await fetchTimedtextLines('https://yt/x', fetchImpl);
    expect(lines).toEqual([
      { startSec: 0, endSec: 2, text: 'hi' },
      { startSec: 2, endSec: 3, text: 'there' },
    ]);
  });

  it('returns [] on 200-with-empty-body (the WEB pot-missing signature, s158)', async () => {
    const fetchImpl = (async () =>
      new Response('', { status: 200 })) as unknown as typeof fetch;

    const lines = await fetchTimedtextLines('https://yt/x', fetchImpl);
    expect(lines).toEqual([]);
  });

  it('throws on non-2xx status (surfaces caller decisions like retry vs bail)', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 403 })) as unknown as typeof fetch;

    await expect(fetchTimedtextLines('https://yt/x', fetchImpl)).rejects.toThrow(
      /timedtext fetch failed: 403/
    );
  });
});
