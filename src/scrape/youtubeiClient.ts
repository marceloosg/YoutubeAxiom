// The `/web` subpath is mandatory (Marcelo s152 spec) -- it avoids the Node.js
// `fs`-dependent platform bindings that crash the RN/Metro bundler. Do not
// import from 'youtubei.js' (root) or 'youtubei.js/node'.
import { Innertube } from 'youtubei.js/web';
import { mapSegments, transcriptToText, TranscriptLine } from './segmentMap';

export type { TranscriptLine };
export { transcriptToText };

export type Breadcrumb = (label: string) => void;

export interface TranscriptResult {
  videoId: string;
  title: string;
  lines: TranscriptLine[];
}

let innertubeSingleton: Innertube | null = null;

async function getInnertube(): Promise<Innertube> {
  if (innertubeSingleton) return innertubeSingleton;
  innertubeSingleton = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: true,
  });
  return innertubeSingleton;
}

/**
 * Fetches a video's transcript via youtubei.js. `onBreadcrumb` is called at each
 * stage transition -- mirrors the Kotlin ScrapeLogFile breadcrumb design so the UI
 * can render a log-over-progress-bar view instead of a spinner.
 */
export async function fetchTranscript(
  videoId: string,
  onBreadcrumb: Breadcrumb = () => {}
): Promise<TranscriptResult> {
  onBreadcrumb('starting_scrape');

  const youtube = await getInnertube();
  onBreadcrumb('primary_start');

  const info = await youtube.getInfo(videoId);
  onBreadcrumb('info_fetched');

  const transcriptInfo = await info.getTranscript();
  onBreadcrumb('transcript_fetched');

  const initialSegments = transcriptInfo.transcript?.content?.body?.initial_segments ?? [];
  if (initialSegments.length === 0) {
    onBreadcrumb('no_captions_found');
    throw new Error('No captions available for this video.');
  }

  const lines = mapSegments(initialSegments as unknown as ReadonlyArray<{
    type?: string;
    start_ms?: string;
    end_ms?: string;
    snippet?: { text?: string; toString?: () => string };
  }>);
  onBreadcrumb('segments_mapped');

  return {
    videoId,
    title: info.basic_info?.title ?? videoId,
    lines,
  };
}
