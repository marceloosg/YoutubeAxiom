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

/**
 * Decodes the small set of XML/HTML entities YouTube's timedtext srv1 payload
 * uses. Hand-rolled to avoid pulling in an XML/HTML lib (RN bundle discipline).
 * Numeric entities (`&#39;`, `&#x27;`) are decoded via a single regex sweep;
 * everything else falls through unchanged.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parses YouTube's timedtext srv1 XML payload (fetched from a caption track's
 * signed `base_url`) into TranscriptLine[]. Regex-only -- no XML lib dep.
 *
 * srv1 shape: `<transcript><text start="0.5" dur="3.2">Hello &amp; goodbye</text>...</transcript>`.
 * YouTube encodes some content with entities and occasionally embeds stripped
 * inline tags (e.g. `<font>`); we decode entities, then strip residual tags.
 * Empty text after decode is skipped.
 */
export function parseTimedtextSrv1(xml: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const re = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const startSec = parseFloat(m[1]);
    const dur = parseFloat(m[2]);
    if (!Number.isFinite(startSec) || !Number.isFinite(dur)) continue;
    // Decode entities first, then strip residual tags (order matters: encoded
    // `&lt;font&gt;` becomes `<font>` on decode and is caught by the tag-strip).
    const decoded = decodeEntities(m[3]).replace(/<[^>]*>/g, '').trim();
    if (decoded.length === 0) continue;
    // Round to ms to avoid float artifacts (0.5 + 3.2 → 3.7000000000000002).
    // srv1 times are decimal-second strings; ms-precision is what UI cares about.
    lines.push({
      startSec: Math.round(startSec * 1000) / 1000,
      endSec: Math.round((startSec + dur) * 1000) / 1000,
      text: decoded,
    });
  }
  return lines;
}
