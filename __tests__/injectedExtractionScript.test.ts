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

describe('EXTRACTION_INJECTED_JS DOM-dump diagnostic (D19, s194)', () => {
  it('collects a dom dump only on the segment_renderer_missing failure path', () => {
    expect(EXTRACTION_INJECTED_JS).toContain('collectDomDump');
    // Fired immediately after (and only alongside) the existing
    // segment_renderer_missing crumb, not on the happy path.
    const missingCrumbIdx = EXTRACTION_INJECTED_JS.indexOf(
      "crumb('dom_shape_shift:segment_renderer_missing')"
    );
    const collectCallIdx = EXTRACTION_INJECTED_JS.indexOf('collectDomDump();');
    expect(missingCrumbIdx).toBeGreaterThan(-1);
    expect(collectCallIdx).toBeGreaterThan(missingCrumbIdx);
  });

  it('posts panel_present, signin_detected, and reload_challenge_detected breadcrumbs', () => {
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('dom_dump:panel_present=' + isTranscriptPanelPresent())");
    expect(EXTRACTION_INJECTED_JS).toContain('detectSigninPrompt');
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('dom_dump:signin_detected='");
    expect(EXTRACTION_INJECTED_JS).toContain('detectReloadChallenge');
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('dom_dump:reload_challenge_detected='");
  });

  it('checks for a "sign in" text/aria-label match to detect the logged-out prompt', () => {
    expect(EXTRACTION_INJECTED_JS).toContain('/sign in/i');
  });

  it('truncates and sanitizes the html snapshot before posting it as a single breadcrumb line', () => {
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('dom_dump:html='");
    expect(EXTRACTION_INJECTED_JS).toContain('.slice(0, 2000)');
    // Strips newlines/tabs/control chars so a raw multi-line HTML dump can't
    // corrupt the single-line breadcrumb log format.
    expect(EXTRACTION_INJECTED_JS).toContain('[\\r\\n\\t\\x00-\\x1F\\x7F]');
  });

  it('guards the diagnostic collection with try/catch so it cannot break the existing failure path', () => {
    const collectFnMatch = EXTRACTION_INJECTED_JS.match(
      /function collectDomDump\(\) \{[\s\S]*?\n  \}/
    );
    expect(collectFnMatch).not.toBeNull();
    const fnBody = collectFnMatch ? collectFnMatch[0] : '';
    // Each of the 4 sub-checks (panel_present, signin_detected,
    // reload_challenge_detected, html) is independently try/catch-wrapped.
    expect((fnBody.match(/try \{/g) || []).length).toBeGreaterThanOrEqual(4);
    expect((fnBody.match(/catch \(e\d\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('EXTRACTION_INJECTED_JS get_transcript fetch/XHR intercept (D19 diagnostic round 2, s195)', () => {
  it('installs the intercept before run() is invoked', () => {
    const installCallIdx = EXTRACTION_INJECTED_JS.indexOf('installTranscriptFetchIntercept();');
    const runDefIdx = EXTRACTION_INJECTED_JS.indexOf('function run() {');
    expect(installCallIdx).toBeGreaterThan(-1);
    expect(runDefIdx).toBeGreaterThan(-1);
    expect(installCallIdx).toBeLessThan(runDefIdx);
  });

  it('hooks both window.fetch and XMLHttpRequest defensively', () => {
    expect(EXTRACTION_INJECTED_JS).toContain('function installTranscriptFetchIntercept()');
    expect(EXTRACTION_INJECTED_JS).toContain('window.fetch = function');
    expect(EXTRACTION_INJECTED_JS).toContain('OrigXHR.prototype.open = function');
    expect(EXTRACTION_INJECTED_JS).toContain('OrigXHR.prototype.send = function');
  });

  it('matches on URLs containing get_transcript', () => {
    const matches = EXTRACTION_INJECTED_JS.match(/indexOf\('get_transcript'\)/g) || [];
    // Both the fetch path and the XHR open() path check for it.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('posts a status breadcrumb, then either an error or an ok breadcrumb, never both', () => {
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('xhr_get_transcript_status=' + status)");
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('xhr_get_transcript_error=' + errMsg)");
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('xhr_get_transcript_ok=' + (bodyText ? bodyText.length : 0))");
  });

  it('does not post the full transcript body, only its length, on success', () => {
    const okCrumbLine = "crumb('xhr_get_transcript_ok=' + (bodyText ? bodyText.length : 0));";
    expect(EXTRACTION_INJECTED_JS).toContain(okCrumbLine);
  });

  it('wraps both interceptor installs in independent try/catch so hooking failures cannot break the scrape flow', () => {
    const fnMatch = EXTRACTION_INJECTED_JS.match(
      /function installTranscriptFetchIntercept\(\) \{[\s\S]*?\n  installTranscriptFetchIntercept\(\);/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch ? fnMatch[0] : '';
    expect(body).toContain('catch (eFetch)');
    expect(body).toContain('catch (eXhr)');
  });
});

describe('EXTRACTION_INJECTED_JS runtime state logging (D19 diagnostic round 2, s195)', () => {
  it('logs the real rendered viewport at the start of run()', () => {
    expect(EXTRACTION_INJECTED_JS).toContain(
      "crumb('webview_viewport=' + window.innerWidth + 'x' + window.innerHeight)"
    );
  });

  it('logs ytcfg LOGGED_IN state with a defensive typeof/fallback', () => {
    expect(EXTRACTION_INJECTED_JS).toContain("typeof ytcfg !== 'undefined' && ytcfg.get");
    expect(EXTRACTION_INJECTED_JS).toContain("ytcfg.get('LOGGED_IN')");
    expect(EXTRACTION_INJECTED_JS).toContain("'ytcfg_unavailable'");
  });

  it('logs the active user agent, truncated to 80 chars', () => {
    expect(EXTRACTION_INJECTED_JS).toContain("crumb('webview_ua=' + navigator.userAgent.slice(0, 80))");
  });

  it('calls logRuntimeState() at the top of run(), before any panel interaction', () => {
    const runFnIdx = EXTRACTION_INJECTED_JS.indexOf('function run() {');
    const logCallIdx = EXTRACTION_INJECTED_JS.indexOf('logRuntimeState();');
    const dismissCallIdx = EXTRACTION_INJECTED_JS.lastIndexOf('dismissConsentIfPresent();');
    expect(runFnIdx).toBeGreaterThan(-1);
    expect(logCallIdx).toBeGreaterThan(runFnIdx);
    expect(logCallIdx).toBeLessThan(dismissCallIdx);
  });

  it('guards each of the three logging breadcrumbs with its own try/catch', () => {
    const fnMatch = EXTRACTION_INJECTED_JS.match(/function logRuntimeState\(\) \{[\s\S]*?\n  \}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch ? fnMatch[0] : '';
    expect(body).toContain('catch (eViewport)');
    expect(body).toContain('catch (eYtcfg)');
    expect(body).toContain('catch (eUa)');
  });
});
