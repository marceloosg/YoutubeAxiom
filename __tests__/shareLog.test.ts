import { composeShareLog } from '../src/log/shareLog';

describe('composeShareLog', () => {
  const fixedMs = Date.UTC(2026, 6, 12, 22, 30, 45); // 2026-07-12T22:30:45Z

  it('composes a header + both sections when both logs have content', () => {
    const out = composeShareLog({
      appVersion: '1.0.4',
      context: 'FaDDitH2WtU',
      atMs: fixedMs,
      breadcrumbLines: ['[22:30:41] starting_stub_upload', '[22:30:42] posting'],
      networkLines: ['[22:30:41] -> POST https://example.com/api'],
    });

    expect(out).toContain('YoutubeAxiom v1.0.4');
    expect(out).toContain('2026-07-12T22:30:45');
    expect(out).toContain('context=FaDDitH2WtU');
    expect(out).toContain('--- breadcrumbs ---');
    expect(out).toContain('[22:30:41] starting_stub_upload');
    expect(out).toContain('[22:30:42] posting');
    expect(out).toContain('--- network ---');
    expect(out).toContain('-> POST https://example.com/api');
    // Sections must appear in order: header, breadcrumbs, network.
    const breadcrumbsIdx = out.indexOf('--- breadcrumbs ---');
    const networkIdx = out.indexOf('--- network ---');
    expect(breadcrumbsIdx).toBeGreaterThan(0);
    expect(networkIdx).toBeGreaterThan(breadcrumbsIdx);
  });

  it('marks empty sections with (empty) so the file always parses', () => {
    const out = composeShareLog({
      appVersion: '1.0.4',
      context: 'test all',
      atMs: fixedMs,
      breadcrumbLines: [],
      networkLines: [],
    });

    expect(out).toContain('context=test all');
    // Both sections still present, each with an (empty) placeholder.
    const emptyMatches = out.match(/\(empty\)/g);
    expect(emptyMatches).toHaveLength(2);
  });

  it('includes the commit SHA in the header when supplied (s162 v1.0.10, msg 7133)', () => {
    const out = composeShareLog({
      appVersion: '1.0.10',
      commitSha: '55cabd1',
      context: 'vid123',
      atMs: fixedMs,
      breadcrumbLines: [],
      networkLines: [],
    });

    expect(out).toContain('YoutubeAxiom v1.0.10 (55cabd1)');
  });

  it('falls back to "local" for the commit SHA when not supplied', () => {
    const out = composeShareLog({
      appVersion: '1.0.10',
      context: 'vid123',
      atMs: fixedMs,
      breadcrumbLines: [],
      networkLines: [],
    });

    expect(out).toContain('YoutubeAxiom v1.0.10 (local)');
  });
});
