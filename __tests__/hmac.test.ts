import { signBody } from '../src/auth/hmac';

describe('signBody', () => {
  it('matches the Python reference implementation byte-for-byte', () => {
    // Reference vector generated with:
    //   python3 -c "import hmac, hashlib; print(hmac.new(b'test-secret-123',
    //   b'{\"video_id\":\"dQw4w9WgXcQ\",\"transcript_text\":\"hello world\",
    //   \"breadcrumbs\":[]}', hashlib.sha256).hexdigest())"
    const secret = 'test-secret-123';
    const body =
      '{"video_id":"dQw4w9WgXcQ","transcript_text":"hello world","breadcrumbs":[]}';
    const expected = '96693605d1879a2132f1ff8a6a56c39dd6cf0630e9147e5add36e5ef06462e9b';

    expect(signBody(secret, body)).toBe(expected);
    expect(signBody(secret, body)).toHaveLength(64);
  });

  it('produces different signatures for different secrets', () => {
    const body = '{"a":1}';
    expect(signBody('secret-a', body)).not.toBe(signBody('secret-b', body));
  });

  it('produces different signatures for different bodies', () => {
    const secret = 'same-secret';
    expect(signBody(secret, '{"a":1}')).not.toBe(signBody(secret, '{"a":2}'));
  });
});
