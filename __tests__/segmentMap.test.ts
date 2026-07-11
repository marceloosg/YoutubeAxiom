import { mapSegments } from '../src/scrape/segmentMap';

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
