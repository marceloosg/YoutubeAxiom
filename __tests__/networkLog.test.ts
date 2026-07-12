import { formatNetworkEntry, NetworkLogEntry } from '../src/log/networkLog';
import { makeInstrumentedFetch } from '../src/log/instrumentedFetch';

describe('formatNetworkEntry', () => {
  it('renders a req entry with method, url, keys, and body', () => {
    const entry: NetworkLogEntry = {
      // 2026-07-12T15:30:45 local -- pin via a known ms then read the time back.
      atMs: new Date(2026, 6, 12, 15, 30, 45).getTime(),
      direction: 'req',
      method: 'POST',
      url: 'https://example.com/api',
      bodyKeys: ['context', 'params', 'videoId'],
      bodyPreview: '{"videoId":"abc"}',
    };
    const line = formatNetworkEntry(entry);
    expect(line).toContain('[15:30:45]');
    expect(line).toContain('-> POST https://example.com/api');
    expect(line).toContain('keys=[context,params,videoId]');
    expect(line).toContain('body="');
  });

  it('renders a resp entry with status and body', () => {
    const entry: NetworkLogEntry = {
      atMs: new Date(2026, 6, 12, 15, 30, 46).getTime(),
      direction: 'resp',
      url: 'https://example.com/api',
      status: 400,
      bodyPreview: '{"error":"bad request"}',
    };
    const line = formatNetworkEntry(entry);
    expect(line).toContain('[15:30:46]');
    expect(line).toContain('<- 400 https://example.com/api');
    expect(line).toContain('body="');
  });
});

describe('makeInstrumentedFetch', () => {
  it('logs both req and resp entries around a baseFetch call', async () => {
    const pushed: NetworkLogEntry[] = [];
    const push = (e: NetworkLogEntry) => {
      pushed.push(e);
    };
    const baseFetch: typeof fetch = jest.fn(async () =>
      new Response('{"ok":true}', { status: 200 })
    ) as unknown as typeof fetch;

    const wrapped = makeInstrumentedFetch(push, baseFetch);
    const resp = await wrapped('https://example.com/api', {
      method: 'POST',
      body: '{"videoId":"abc"}',
    });

    expect(resp.status).toBe(200);
    expect(pushed).toHaveLength(2);
    expect(pushed[0].direction).toBe('req');
    expect(pushed[0].method).toBe('POST');
    expect(pushed[0].url).toBe('https://example.com/api');
    expect(pushed[0].bodyKeys).toEqual(['videoId']);
    expect(pushed[1].direction).toBe('resp');
    expect(pushed[1].status).toBe(200);
    expect(pushed[1].bodyPreview).toContain('ok');
    // Response body must still be readable by the caller after logging.
    expect(await resp.text()).toBe('{"ok":true}');
  });

  it('redacts sensitive headers and visitor_data body keys in the preview', async () => {
    const pushed: NetworkLogEntry[] = [];
    const push = (e: NetworkLogEntry) => {
      pushed.push(e);
    };
    const baseFetch: typeof fetch = jest.fn(async () =>
      new Response('{}', { status: 200 })
    ) as unknown as typeof fetch;

    const wrapped = makeInstrumentedFetch(push, baseFetch);
    await wrapped('https://example.com/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Axiom-Signature': 'deadbeef',
      },
      body: JSON.stringify({
        visitor_data: 'SECRET_TOKEN',
        videoId: 'abc',
      }),
    });

    const req = pushed[0];
    expect(req.headersPreview).toBeDefined();
    expect(req.headersPreview!['X-Axiom-Signature']).toBe('<redacted>');
    // Non-sensitive headers pass through.
    expect(req.headersPreview!['Content-Type']).toBe('application/json');
    // visitor_data must be redacted in the body preview.
    expect(req.bodyPreview).toContain('<redacted>');
    expect(req.bodyPreview).not.toContain('SECRET_TOKEN');
    // The original key list is preserved so debugging can see the shape.
    expect(req.bodyKeys).toContain('visitor_data');
    expect(req.bodyKeys).toContain('videoId');
  });
});
