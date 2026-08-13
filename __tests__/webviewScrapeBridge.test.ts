import {
  __resetWebViewScrapeBridgeForTests,
  isWebViewScrapeHandlerRegistered,
  registerWebViewScrapeHandler,
  requestWebViewScrape,
} from '../src/webview/webviewScrapeBridge';

beforeEach(() => {
  __resetWebViewScrapeBridgeForTests();
});

describe('webviewScrapeBridge (s193, D19 Shape A)', () => {
  it('resolves null with zero breadcrumbs when no handler is registered', async () => {
    const breadcrumbs: string[] = [];
    const result = await requestWebViewScrape('vid123', (l) => breadcrumbs.push(l));
    expect(result).toBeNull();
    expect(breadcrumbs).toEqual([]);
  });

  it('reports isWebViewScrapeHandlerRegistered correctly across register/unregister', () => {
    expect(isWebViewScrapeHandlerRegistered()).toBe(false);
    const unregister = registerWebViewScrapeHandler(async () => []);
    expect(isWebViewScrapeHandlerRegistered()).toBe(true);
    unregister();
    expect(isWebViewScrapeHandlerRegistered()).toBe(false);
  });

  it('returns the handler-resolved lines and emits start/ok breadcrumbs on success', async () => {
    registerWebViewScrapeHandler(async (videoId) => [
      { startSec: 0, endSec: 2, text: `scraped for ${videoId}` },
    ]);

    const breadcrumbs: string[] = [];
    const result = await requestWebViewScrape('vid123', (l) => breadcrumbs.push(l));

    expect(result).toEqual([{ startSec: 0, endSec: 2, text: 'scraped for vid123' }]);
    expect(breadcrumbs).toEqual(['webview_scrape_start', 'webview_scrape_ok=1']);
  });

  it('threads the onBreadcrumb callback through to the handler', async () => {
    registerWebViewScrapeHandler(async (_videoId, onBreadcrumb) => {
      onBreadcrumb('webview_consent_dismissed');
      onBreadcrumb('webview_transcript_button_clicked');
      return [{ startSec: 0, endSec: 1, text: 'ok' }];
    });

    const breadcrumbs: string[] = [];
    await requestWebViewScrape('vid123', (l) => breadcrumbs.push(l));

    expect(breadcrumbs).toEqual([
      'webview_scrape_start',
      'webview_consent_dismissed',
      'webview_transcript_button_clicked',
      'webview_scrape_ok=1',
    ]);
  });

  it('resolves null and emits a fail breadcrumb when the handler returns empty lines', async () => {
    registerWebViewScrapeHandler(async () => []);

    const breadcrumbs: string[] = [];
    const result = await requestWebViewScrape('vid123', (l) => breadcrumbs.push(l));

    expect(result).toBeNull();
    expect(breadcrumbs).toEqual(['webview_scrape_start', 'webview_scrape_fail=empty_lines']);
  });

  it('resolves null and emits a fail breadcrumb when the handler throws', async () => {
    registerWebViewScrapeHandler(async () => {
      throw new Error('no_segments_scraped');
    });

    const breadcrumbs: string[] = [];
    const result = await requestWebViewScrape('vid123', (l) => breadcrumbs.push(l));

    expect(result).toBeNull();
    expect(breadcrumbs).toEqual(['webview_scrape_start', 'webview_scrape_fail=no_segments_scraped']);
  });

  it('resolves null on timeout when the handler never settles', async () => {
    registerWebViewScrapeHandler(() => new Promise(() => {})); // never resolves

    const breadcrumbs: string[] = [];
    const result = await requestWebViewScrape('vid123', (l) => breadcrumbs.push(l), 20);

    expect(result).toBeNull();
    expect(breadcrumbs).toEqual(['webview_scrape_start', 'webview_scrape_fail=timeout']);
  });
});
