import { fetchTranscriptViaProxy } from '../src/backend/ytTranscriptProxy';
import { signBody } from '../src/auth/hmac';

const TEST_SECRET = 'yt-transcript-test-secret';
const TEST_BASE_URL = 'http://100.27.246.241:8737';

function mockFetchOnce(status: number, payload: unknown): jest.Mock {
  return jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  })) as unknown as jest.Mock;
}

describe('fetchTranscriptViaProxy', () => {
  it('returns the parsed transcript + signs the request on a 200 response', async () => {
    const fetchMock = mockFetchOnce(200, {
      video_id: 'dQw4w9WgXcQ',
      source: 'auto',
      srv1_xml: '<transcript><text start="0" dur="1">never gonna give you up</text></transcript>',
      text: 'never gonna give you up',
      byte_len: 92,
    });

    const breadcrumbs: string[] = [];
    const result = await fetchTranscriptViaProxy(
      'dQw4w9WgXcQ',
      { baseUrl: TEST_BASE_URL, secret: TEST_SECRET },
      fetchMock as unknown as typeof fetch,
      (l) => breadcrumbs.push(l)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TEST_BASE_URL}/transcript`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const sentBody = init.body as string;
    expect(JSON.parse(sentBody)).toEqual({ video_id: 'dQw4w9WgXcQ' });

    const signature = init.headers['X-Axiom-Auth'] as string;
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(signBody(TEST_SECRET, sentBody));

    expect(result).toEqual({
      source: 'auto',
      text: 'never gonna give you up',
      byteLen: 92,
      srv1Xml: '<transcript><text start="0" dur="1">never gonna give you up</text></transcript>',
    });
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatch(/^backend_proxy_ok elapsed_ms=\d+$/);
  });

  it('returns null and emits backend_proxy_fail on a 401 (HMAC mismatch) response', async () => {
    const fetchMock = mockFetchOnce(401, { error: 'unauthorized' });

    const breadcrumbs: string[] = [];
    const result = await fetchTranscriptViaProxy(
      'dQw4w9WgXcQ',
      { baseUrl: TEST_BASE_URL, secret: TEST_SECRET },
      fetchMock as unknown as typeof fetch,
      (l) => breadcrumbs.push(l)
    );

    expect(result).toBeNull();
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatch(/^backend_proxy_fail=unauthorized elapsed_ms=\d+$/);
  });

  it('returns null and emits backend_proxy_fail on a network error (fetch rejects)', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const breadcrumbs: string[] = [];
    const result = await fetchTranscriptViaProxy(
      'dQw4w9WgXcQ',
      { baseUrl: TEST_BASE_URL, secret: TEST_SECRET },
      fetchMock,
      (l) => breadcrumbs.push(l)
    );

    expect(result).toBeNull();
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatch(
      /^backend_proxy_fail=TypeError:Network request failed elapsed_ms=\d+$/
    );
  });

  it('aborts via its own timeout (not a platform default) and resolves to null, distinguishing reason=timeout from other errors', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
        // Never resolves on its own -- only settles when the AbortController
        // (wired via `init.signal`) fires, mirroring how a real hung
        // connection behaves against fetch()'s abort contract.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      const breadcrumbs: string[] = [];
      const resultPromise = fetchTranscriptViaProxy(
        'dQw4w9WgXcQ',
        { baseUrl: TEST_BASE_URL, secret: TEST_SECRET },
        fetchMock,
        (l) => breadcrumbs.push(l)
      );

      // Advance past PROXY_TIMEOUT_MS (70s) without a real 70s wait.
      await jest.advanceTimersByTimeAsync(70_001);

      const result = await resultPromise;

      expect(result).toBeNull();
      expect(breadcrumbs).toHaveLength(1);
      expect(breadcrumbs[0]).toMatch(/^backend_proxy_fail=timeout elapsed_ms=\d+$/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not fire our timeout when the backend responds well within PROXY_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
          setTimeout(() => {
            resolve({
              status: 200,
              ok: true,
              json: async () => ({
                video_id: 'dQw4w9WgXcQ',
                source: 'auto',
                text: 'never gonna give you up',
                byte_len: 92,
              }),
            } as unknown as Response);
          }, 50);
        });
      }) as unknown as typeof fetch;

      const breadcrumbs: string[] = [];
      const resultPromise = fetchTranscriptViaProxy(
        'dQw4w9WgXcQ',
        { baseUrl: TEST_BASE_URL, secret: TEST_SECRET },
        fetchMock,
        (l) => breadcrumbs.push(l)
      );

      await jest.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result).not.toBeNull();
      expect(breadcrumbs).toHaveLength(1);
      const match = breadcrumbs[0].match(/^backend_proxy_ok elapsed_ms=(\d+)$/);
      expect(match).not.toBeNull();
      const elapsedMs = Number(match?.[1]);
      // Mocked delay was 50ms -- elapsed should be small, well under the 70s
      // timeout ceiling (a loose upper bound keeps this robust to fake-timer
      // scheduling jitter without re-testing the exact 50ms figure).
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
      expect(elapsedMs).toBeLessThan(5_000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('signs the raw JSON body with plain (non-timestamped) HMAC-SHA256, matching the Python reference', () => {
    // Reference vector generated with:
    //   python3 -c "import hmac, hashlib; print(hmac.new(
    //   b'yt-transcript-test-secret', b'{\"video_id\":\"dQw4w9WgXcQ\"}',
    //   hashlib.sha256).hexdigest())"
    // This is the exact scheme `_valid_hmac` in infra/axiom-yt-transcript/main.py
    // expects for the X-Axiom-Auth header -- no timestamp component (unlike
    // axiom-lightrag's X-Axiom-Signature + X-Axiom-Timestamp scheme).
    const body = '{"video_id":"dQw4w9WgXcQ"}';
    const expected = 'e693e4ebd688c4af6bbfbd6b6ec28ae84872a444937f80cffe82fc7421394929';
    expect(signBody(TEST_SECRET, body)).toBe(expected);
    expect(signBody(TEST_SECRET, body)).toHaveLength(64);
  });

  it('returns null and emits backend_proxy_fail=empty_text when the 200 payload has no text', async () => {
    const fetchMock = mockFetchOnce(200, { video_id: 'x', source: 'auto', text: '', byte_len: 0 });

    const breadcrumbs: string[] = [];
    const result = await fetchTranscriptViaProxy(
      'x',
      { baseUrl: TEST_BASE_URL, secret: TEST_SECRET },
      fetchMock as unknown as typeof fetch,
      (l) => breadcrumbs.push(l)
    );

    expect(result).toBeNull();
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatch(/^backend_proxy_fail=empty_text elapsed_ms=\d+$/);
  });
});
