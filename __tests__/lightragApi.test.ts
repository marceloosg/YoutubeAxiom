import { postIngest, postAsk } from '../src/backend/lightragApi';
import { signBodyWithTimestamp } from '../src/auth/hmac';

const TEST_SECRET = 'lightrag-test-secret';
const TEST_BASE_URL = 'https://axiom-lightrag.placeholder.internal:8738';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        lightragBaseUrl: 'https://axiom-lightrag.placeholder.internal:8738',
        lightragSecret: 'lightrag-test-secret',
      },
    },
  },
}));

function mockFetchOnce(status: number, payload: unknown): jest.Mock {
  return jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  })) as unknown as jest.Mock;
}

describe('postIngest', () => {
  it('POSTs to /ingest with url body, HMAC headers, and application/json content-type', async () => {
    const fetchMock = mockFetchOnce(200, {
      crawl_id: 'abc123',
      video_id: 'dQw4w9WgXcQ',
      state: 'indexed',
    });

    const result = await postIngest('https://www.youtube.com/watch?v=dQw4w9WgXcQ', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TEST_BASE_URL}/ingest`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const sentBody = init.body as string;
    expect(JSON.parse(sentBody)).toEqual({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

    const signature = init.headers['X-Axiom-Signature'] as string;
    const timestamp = init.headers['X-Axiom-Timestamp'] as string;
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(timestamp).toMatch(/^\d+$/);
    expect(signature).toBe(signBodyWithTimestamp(TEST_SECRET, Number(timestamp), sentBody));

    expect(result).toEqual({ crawl_id: 'abc123', video_id: 'dQw4w9WgXcQ', state: 'indexed' });
  });

  it('throws with the backend error message on a non-200 response', async () => {
    const fetchMock = mockFetchOnce(400, { error: 'invalid_url' });
    await expect(
      postIngest('not-a-url', fetchMock as unknown as typeof fetch)
    ).rejects.toThrow('invalid_url');
  });
});

describe('postAsk', () => {
  it('POSTs to /ask with query body, HMAC headers, and application/json content-type', async () => {
    const fetchMock = mockFetchOnce(200, {
      answer_text: 'Dr K discusses hyperfocus at 12:34.',
      citations: [],
    });

    const result = await postAsk('what does Dr K say about ADHD?', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TEST_BASE_URL}/ask`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const sentBody = init.body as string;
    expect(JSON.parse(sentBody)).toEqual({ query: 'what does Dr K say about ADHD?' });

    const signature = init.headers['X-Axiom-Signature'] as string;
    const timestamp = init.headers['X-Axiom-Timestamp'] as string;
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(signBodyWithTimestamp(TEST_SECRET, Number(timestamp), sentBody));

    expect(result.answer_text).toBe('Dr K discusses hyperfocus at 12:34.');
  });

  it('throws with the backend error message on a non-200 response', async () => {
    const fetchMock = mockFetchOnce(500, { error: 'query_failed', detail: 'boom' });
    await expect(
      postAsk('anything', fetchMock as unknown as typeof fetch)
    ).rejects.toThrow('query_failed');
  });
});
