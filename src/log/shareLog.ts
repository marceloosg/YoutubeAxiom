/**
 * Compose the full log text shared out of the app.
 *
 * Extracted as a pure function so we can unit-test the shape without wiring
 * expo-file-system or expo-sharing (both are native modules unmockable in the
 * default Jest env). The output is one plain-text blob that TG/Files/Drive
 * receive as an attachment (see `App.onShareLog` for the file wiring).
 *
 * Header shape:
 *   `YoutubeAxiom v<appVersion> (<commitSha>) | <iso timestamp> | context=<context>`
 *
 * `context` is the video ID for a single-Extract run, or the literal string
 * `test all` for the Test All 3 harness (s157 diagnostic).
 *
 * `commitSha` (msg 7133): lets Marcelo confirm which build produced a given
 * log. Optional -- defaults to `'local'`, matching `resolveCommitSha`'s
 * fallback (`src/util/appVersion.ts`), for callers that don't have a resolved
 * SHA on hand.
 */

export interface ComposeShareLogInput {
  appVersion: string;
  /** Build commit SHA (short form). Defaults to `'local'` when omitted. */
  commitSha?: string;
  /** Video ID for single-Extract, or `test all` for the batch harness. */
  context: string;
  /** Millis-since-epoch of the share action (deterministic for tests). */
  atMs: number;
  breadcrumbLines: string[];
  networkLines: string[];
}

export function composeShareLog(input: ComposeShareLogInput): string {
  const iso = new Date(input.atMs).toISOString();
  const commitSha = input.commitSha ?? 'local';
  const header = `YoutubeAxiom v${input.appVersion} (${commitSha}) | ${iso} | context=${input.context}`;
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
