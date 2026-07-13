// The `/web` subpath is mandatory (Marcelo s152 spec) -- it avoids the Node.js
// `fs`-dependent platform bindings that crash the RN/Metro bundler. Do not
// import from 'youtubei.js' (root) or 'youtubei.js/node'.
import { Innertube, ClientType } from 'youtubei.js/web';
import {
  CaptionTrackLike,
  fetchTimedtextLines,
  mapSegments,
  pickCaptionTrack,
  transcriptToText,
  TranscriptLine,
} from './segmentMap';

export type { TranscriptLine };
export { transcriptToText };

export type Breadcrumb = (label: string) => void;

export interface TranscriptResult {
  videoId: string;
  title: string;
  lines: TranscriptLine[];
}

let innertubeSingleton: Innertube | null = null;

async function getInnertube(customFetch?: typeof fetch): Promise<Innertube> {
  // A caller-supplied fetch is only used in debug flows and must not poison the
  // shared singleton (would break subsequent default-fetch UI calls). Rebuild a
  // fresh Innertube for those; default path keeps the cached singleton.
  if (customFetch) {
    return Innertube.create({
      lang: 'en',
      location: 'US',
      retrieve_player: true,
      fetch: customFetch,
    });
  }
  if (innertubeSingleton) return innertubeSingleton;
  innertubeSingleton = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: true,
  });
  return innertubeSingleton;
}

/**
 * Fetches ANDROID-client caption_tracks for `videoId`. The WEB client's signed
 * timedtext URLs went pot-gated in 2025 -- signature validates (200) but the
 * body is empty. ANDROID uses a separate signing path that (so far) does not
 * require pot, so we build a second Innertube against ClientType.ANDROID and
 * re-fetch info to pick a working track.
 *
 * Always builds a fresh instance (not shared with the WEB singleton) since
 * client_type is baked into session context.
 */
async function getAndroidCaptionTracks(
  videoId: string,
  customFetch?: typeof fetch
): Promise<CaptionTrackLike[]> {
  const androidYt = await Innertube.create({
    client_type: ClientType.ANDROID,
    lang: 'en',
    location: 'US',
    retrieve_player: true,
    ...(customFetch ? { fetch: customFetch } : {}),
  });
  const androidInfo = await androidYt.getInfo(videoId);
  const androidCaptions = (androidInfo as unknown as {
    captions?: { caption_tracks?: CaptionTrackLike[] };
  }).captions;
  return androidCaptions?.caption_tracks ?? [];
}

/**
 * Fetches a video's transcript via youtubei.js. `onBreadcrumb` is called at each
 * stage transition -- mirrors the Kotlin ScrapeLogFile breadcrumb design so the UI
 * can render a log-over-progress-bar view instead of a spinner.
 *
 * `customFetch` (optional) wraps the underlying InnerTube HTTP call; used by the
 * in-app network log for debug. When present, the singleton is bypassed.
 */
export async function fetchTranscript(
  videoId: string,
  onBreadcrumb: Breadcrumb = () => {},
  customFetch?: typeof fetch
): Promise<TranscriptResult> {
  onBreadcrumb('starting_scrape');

  const youtube = await getInnertube(customFetch);
  onBreadcrumb('primary_start');

  const info = await youtube.getInfo(videoId);
  onBreadcrumb('info_fetched');

  // Guard against get_transcript's HTTP 400 (see s157 root cause). YouTube
  // returns 400 whenever the info response lacks transcript-panel params.
  // Two real cases (both reproduced on this box against v17.2.0):
  //   1. Zero captions (FaDDitH2WtU: info.captions == null, has_transcript == false).
  //   2. Has captions but no transcript panel (dQw4w9WgXcQ: 6 caption_tracks,
  //      has_transcript == false).
  // The signed `caption_tracks[i].base_url` returns the caption XML directly,
  // so case 2 falls back to a direct timedtext fetch through the same custom
  // fetch (keeps the debug network log intact).
  const captionsAny = (info as unknown as {
    captions?: { caption_tracks?: CaptionTrackLike[] };
    has_transcript?: boolean;
  }).captions;
  const captionTracks = captionsAny?.caption_tracks ?? [];
  const hasTranscript = (info as unknown as { has_transcript?: boolean }).has_transcript === true;

  if (captionTracks.length === 0 && !hasTranscript) {
    onBreadcrumb('no_captions_found');
    throw new Error('No captions available for this video.');
  }

  // Use the caller-supplied fetch when present so the debug network log
  // records the timedtext GET; otherwise fall through to global fetch.
  const fetchImpl: typeof fetch = customFetch ?? fetch;

  let lines: TranscriptLine[];
  try {
    const transcriptInfo = await info.getTranscript();
    onBreadcrumb('transcript_fetched');

    const initialSegments = transcriptInfo.transcript?.content?.body?.initial_segments ?? [];
    if (initialSegments.length === 0) {
      onBreadcrumb('no_captions_found');
      throw new Error('No captions available for this video.');
    }

    lines = mapSegments(initialSegments as unknown as ReadonlyArray<{
      type?: string;
      start_ms?: string;
      end_ms?: string;
      snippet?: { text?: string; toString?: () => string };
    }>);
    onBreadcrumb('segments_mapped');
  } catch (err) {
    // Only fall back when caption_tracks exist -- otherwise there's nothing to
    // fetch and the raw 400 error is just noise. Mask it as the same
    // user-facing "no captions" message the pre-check emits.
    if (captionTracks.length === 0) {
      onBreadcrumb('no_captions_found');
      throw new Error('No captions available for this video.');
    }

    onBreadcrumb('transcript_fetch_fallback');
    // Prefer manual English → any English → first track. Manual English is
    // higher quality than ASR ("auto-generated speech recognition").
    const track = pickCaptionTrack(captionTracks);

    const baseUrl = track?.base_url;
    if (!baseUrl) {
      // Track record with no base_url is a caption-shape violation from
      // youtubei.js; treat as unrecoverable and rethrow the original error.
      throw err;
    }

    lines = await fetchTimedtextLines(baseUrl, fetchImpl);

    if (lines.length === 0) {
      // WEB srv1 200-with-empty-body: signature valid, but pot ("proof of
      // origin token") is missing on YouTube's 2025 signed caption URLs.
      // Retry via ANDROID Innertube: its caption_tracks are signed on a path
      // that does not (yet) require pot. If ANDROID also comes back empty or
      // errors, surface the standard "no captions" message.
      onBreadcrumb('timedtext_empty_retry_android');
      try {
        const androidTracks = await getAndroidCaptionTracks(videoId, customFetch);
        const androidTrack = pickCaptionTrack(androidTracks);
        const androidBaseUrl = androidTrack?.base_url;
        if (!androidBaseUrl) {
          onBreadcrumb('no_captions_found');
          throw new Error('No captions available for this video.');
        }

        lines = await fetchTimedtextLines(androidBaseUrl, fetchImpl);
        if (lines.length === 0) {
          onBreadcrumb('no_captions_found');
          throw new Error('No captions available for this video.');
        }
      } catch (androidErr) {
        // Only unwrap when we already surfaced "no captions". Any other error
        // (fetch failure, Innertube.create rejection, etc.) still counts as
        // "captions not retrievable" for the user; preserve the message shape.
        if (androidErr instanceof Error &&
            androidErr.message === 'No captions available for this video.') {
          throw androidErr;
        }
        onBreadcrumb('no_captions_found');
        throw new Error('No captions available for this video.');
      }
    }
    onBreadcrumb('transcript_fetched');
    onBreadcrumb('segments_mapped');
  }

  return {
    videoId,
    title: info.basic_info?.title ?? videoId,
    lines,
  };
}
