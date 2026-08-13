import {
  EXTRACTION_INJECTED_JS,
  extractionTargetUrl,
  parseExtractionMessage,
  parseTimestampToSeconds,
} from '../src/webview/injectedExtractionScript';

describe('extractionTargetUrl (s193, D19 Shape A)', () => {
  it('builds the desktop watch URL for a given video id', () => {
    expect(extractionTargetUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });
});

describe('parseTimestampToSeconds', () => {
  it('parses mm:ss', () => {
    expect(parseTimestampToSeconds('0:05')).toBe(5);
    expect(parseTimestampToSeconds('1:02')).toBe(62);
  });

  it('parses h:mm:ss', () => {
    expect(parseTimestampToSeconds('1:02:03')).toBe(3723);
  });

  it('returns 0 for undefined/empty/unparseable input', () => {
    expect(parseTimestampToSeconds(undefined)).toBe(0);
    expect(parseTimestampToSeconds('')).toBe(0);
    expect(parseTimestampToSeconds('not-a-timestamp')).toBe(0);
  });
});

describe('parseExtractionMessage', () => {
  it('parses a result message with segments', () => {
    const raw = JSON.stringify({
      type: 'yt_extract_result',
      segments: [
        { text: 'hello there', timestamp: '0:00' },
        { text: 'general kenobi', timestamp: '0:05' },
      ],
    });
    expect(parseExtractionMessage(raw)).toEqual({
      type: 'yt_extract_result',
      segments: [
        { text: 'hello there', timestamp: '0:00' },
        { text: 'general kenobi', timestamp: '0:05' },
      ],
    });
  });

  it('drops malformed segment entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      type: 'yt_extract_result',
      segments: [{ text: 'ok' }, { notText: 'nope' }, { text: 42 }, null],
    });
    expect(parseExtractionMessage(raw)).toEqual({
      type: 'yt_extract_result',
      segments: [{ text: 'ok', timestamp: undefined }],
    });
  });

  it('parses an error message', () => {
    const raw = JSON.stringify({ type: 'yt_extract_error', reason: 'no_segments_scraped' });
    expect(parseExtractionMessage(raw)).toEqual({
      type: 'yt_extract_error',
      reason: 'no_segments_scraped',
    });
  });

  it('parses a breadcrumb message', () => {
    const raw = JSON.stringify({ type: 'yt_extract_breadcrumb', label: 'consent_dismissed' });
    expect(parseExtractionMessage(raw)).toEqual({
      type: 'yt_extract_breadcrumb',
      label: 'consent_dismissed',
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parseExtractionMessage('not json{')).toBeNull();
  });

  it('returns null for valid JSON missing a recognized type', () => {
    expect(parseExtractionMessage(JSON.stringify({ foo: 'bar' }))).toBeNull();
    expect(parseExtractionMessage(JSON.stringify({ type: 'unknown_type' }))).toBeNull();
  });
});

describe('EXTRACTION_INJECTED_JS (resilient-selector contract)', () => {
  it('is a non-empty script string', () => {
    expect(typeof EXTRACTION_INJECTED_JS).toBe('string');
    expect(EXTRACTION_INJECTED_JS.length).toBeGreaterThan(100);
  });

  it('ends with `true;` (required by older RN WebView injectedJavaScript contract)', () => {
    expect(EXTRACTION_INJECTED_JS.trim().endsWith('true;')).toBe(true);
  });

  it('references the resilient transcript-segment selector', () => {
    expect(EXTRACTION_INJECTED_JS).toContain('ytd-transcript-segment-renderer');
    expect(EXTRACTION_INJECTED_JS).toContain('segment-text');
  });

  it('emits dom_shape_shift breadcrumbs for diagnosability when selectors miss (deliverable item 7)', () => {
    expect(EXTRACTION_INJECTED_JS).toContain('dom_shape_shift:transcript_button_missing');
    expect(EXTRACTION_INJECTED_JS).toContain('dom_shape_shift:segment_renderer_missing');
  });

  it('attempts to dismiss a consent interstitial before opening the transcript (Q4)', () => {
    expect(EXTRACTION_INJECTED_JS).toContain('dismissConsentIfPresent');
  });
});
