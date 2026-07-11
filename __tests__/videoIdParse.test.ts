import { parseVideoId } from '../src/util/videoId';

describe('parseVideoId', () => {
  const ID = 'dQw4w9WgXcQ';

  it('parses youtu.be short links', () => {
    expect(parseVideoId(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it('parses youtu.be short links with query params', () => {
    expect(parseVideoId(`https://youtu.be/${ID}?t=30`)).toBe(ID);
  });

  it('parses standard watch URLs', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('parses watch URLs with extra query params', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}&t=30s&list=abc`)).toBe(ID);
  });

  it('parses watch URLs without www', () => {
    expect(parseVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('parses embed URLs', () => {
    expect(parseVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  it('parses shorts URLs', () => {
    expect(parseVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it('parses a bare video ID', () => {
    expect(parseVideoId(ID)).toBe(ID);
  });

  it('returns null for garbage input', () => {
    expect(parseVideoId('not a url at all')).toBeNull();
  });

  it('returns null for a URL with no video id', () => {
    expect(parseVideoId('https://www.youtube.com/')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('   ')).toBeNull();
  });
});
