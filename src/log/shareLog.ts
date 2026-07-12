/**
 * Compose the full log text shared out of the app.
 *
 * Extracted as a pure function so we can unit-test the shape without wiring
 * expo-file-system or expo-sharing (both are native modules unmockable in the
 * default Jest env). The output is one plain-text blob that TG/Files/Drive
 * receive as an attachment (see `App.onShareLog` for the file wiring).
 *
 * Header shape:
 *   `YoutubeAxiom v<appVersion> | <iso timestamp> | context=<context>`
 *
 * `context` is the video ID for a single-Extract run, or the literal string
 * `test all` for the Test All 3 harness (s157 diagnostic).
 */

export interface ComposeShareLogInput {
  appVersion: string;
  /** Video ID for single-Extract, or `test all` for the batch harness. */
  context: string;
  /** Millis-since-epoch of the share action (deterministic for tests). */
  atMs: number;
  breadcrumbLines: string[];
  networkLines: string[];
}

export function composeShareLog(input: ComposeShareLogInput): string {
  const iso = new Date(input.atMs).toISOString();
  const header = `YoutubeAxiom v${input.appVersion} | ${iso} | context=${input.context}`;
  const sections: string[] = [header, '', '--- breadcrumbs ---'];
  if (input.breadcrumbLines.length > 0) {
    sections.push(...input.breadcrumbLines);
  } else {
    sections.push('(empty)');
  }
  sections.push('', '--- network ---');
  if (input.networkLines.length > 0) {
    sections.push(...input.networkLines);
  } else {
    sections.push('(empty)');
  }
  return sections.join('\n');
}
