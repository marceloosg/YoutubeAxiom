/**
 * Pure segment-mapping logic, split out from youtubeiClient.ts so it can be
 * unit-tested without pulling in the youtubei.js ESM module graph (which Jest's
 * default transformIgnorePatterns doesn't parse without extra config).
 */

export interface TranscriptLine {
  startSec: number;
  endSec: number;
  text: string;
}

export interface RawTranscriptSegment {
  type?: string;
  start_ms?: string;
  end_ms?: string;
  snippet?: { text?: string; toString?: () => string };
}

/**
 * Maps youtubei.js's raw `initial_segments` (TranscriptSegment | TranscriptSectionHeader)
 * into plain {startSec, endSec, text} lines. Section headers (chapter markers) are
 * skipped -- they carry no start_ms/end_ms/snippet.
 */
export function mapSegments(segments: ReadonlyArray<RawTranscriptSegment>): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const seg of segments) {
    if (seg.type === 'TranscriptSectionHeader') continue;
    if (seg.start_ms === undefined || seg.end_ms === undefined) continue;

    const text = seg.snippet?.text ?? seg.snippet?.toString?.() ?? '';
    lines.push({
      startSec: Math.round(Number(seg.start_ms)) / 1000,
      endSec: Math.round(Number(seg.end_ms)) / 1000,
      text: text.trim(),
    });
  }
  return lines;
}

/** Joins transcript lines into a single plain-text blob for the backend POST. */
export function transcriptToText(lines: TranscriptLine[]): string {
  return lines.map((l) => l.text).join('\n');
}
