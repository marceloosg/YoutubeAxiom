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
  //
  // s162 Path A: `retrieve_player: false` -- captions don't need player
  // streams, and `retrieve_player: true` was the likely trigger for the
  // youtubei.js PlayerStoryboardSpec parse bug (TypeError across every
  // fallback tier in the v1.0.8 device log, msg 7086 s162; matches
  // LuanRT/YouTube.js#196, #671, #841).
  if (customFetch) {
    return Innertube.create({
      lang: 'en',
      location: 'US',
      retrieve_player: false,
      fetch: customFetch,
    });
  }
  if (innertubeSingleton) return innertubeSingleton;
  innertubeSingleton = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: false,
  });
  return innertubeSingleton;
}

// Retry-tier client types, in fallback order. NOTE: youtubei.js's real
// ClientType export (v17.2.0, node_modules/youtubei.js/dist/src/core/Session.js)
// has no `TVHTML5` key -- the TV client lives at `ClientType.TV` (value
// `"TVHTML5"`). Reference the enum members directly rather than string
// literals so a future youtubei.js bump that renames a value doesn't silently
// pass `client_type: undefined`.
//
// s162 Path A: ANDROID and IOS were dropped from the retry chain. Per the
// yt-dlp PO Token Guide (2026), ANDROID and IOS both require a pot for
// GVS/Player -- exactly the failure mode this fallback exists to route
// around, so retrying through them was futile. TVHTML5 and ANDROID_VR do NOT
// require a pot. Confirmed at STEP 0 (this ship): `ClientType.ANDROID_VR` ===
// `"ANDROID_VR"` in the installed youtubei.js@17.2.0.
export type RetryClientType = typeof ClientType.TV | typeof ClientType.ANDROID_VR;

/**
 * Diagnostic label + entry breadcrumb per retry tier, keyed by the
 * `ClientType` value (not the enum key name, since `ClientType.TV`'s value is
 * `"TVHTML5"`). Machine-greppable strings so on-device logs immediately show
 * which tier had caption_tracks available: `tvhtml5_tracks=N`,
 * `android_vr_tracks=N`.
 */
const RETRY_TIER_META: Record<string, { enterBreadcrumb: string; tracksLabel: string }> = {
  [ClientType.TV]: { enterBreadcrumb: 'timedtext_empty_retry_tvhtml5', tracksLabel: 'tvhtml5_tracks' },
  [ClientType.ANDROID_VR]: { enterBreadcrumb: 'timedtext_empty_retry_android_vr', tracksLabel: 'android_vr_tracks' },
};

/**
 * Ordered fallback chain: WEB (primary, handled by the caller) -> TVHTML5 ->
 * ANDROID_VR. TVHTML5 goes first -- per the yt-dlp PO Token Guide neither
 * client requires a pot for GVS/Player, and TVHTML5 was already the
 * best-performing pot-free tier in prior device logs.
 */
const RETRY_CLIENT_ORDER: RetryClientType[] = [ClientType.TV, ClientType.ANDROID_VR];

const NO_CAPTIONS_MESSAGE = 'No captions available for this video.';

function noCaptionsError(): Error {
  return new Error(NO_CAPTIONS_MESSAGE);
}

/**
 * Fetches caption_tracks for `videoId` via an alternate Innertube client
 * (TV / ANDROID_VR). The WEB client's signed timedtext URLs went pot-gated
 * in 2025 -- signature validates (200) but the body is empty. TVHTML5 and
 * ANDROID_VR do not require a pot for GVS/Player (yt-dlp PO Token Guide,
 * 2026), so we build a fresh Innertube against the given client_type and
 * re-fetch info to pick a working track.
 *
 * `retrieve_player: false` -- captions don't need player streams; skipping
 * player retrieval avoids the youtubei.js PlayerStoryboardSpec parse-bug path
 * implicated in the v1.0.8 device-log TypeError (s162, matches
 * LuanRT/YouTube.js#196, #671, #841).
 *
 * Always builds a fresh instance (not shared with the WEB singleton) since
 * client_type is baked into session context.
 */
async function getClientCaptionTracks(
  clientType: RetryClientType,
  videoId: string,
  customFetch?: typeof fetch
): Promise<CaptionTrackLike[]> {
  const clientYt = await Innertube.create({
    client_type: clientType,
    lang: 'en',
    location: 'US',
    retrieve_player: false,
    ...(customFetch ? { fetch: customFetch } : {}),
  });
  const clientInfo = await clientYt.getInfo(videoId);
  const clientCaptions = (clientInfo as unknown as {
    captions?: { caption_tracks?: CaptionTrackLike[] };
  }).captions;
  return clientCaptions?.caption_tracks ?? [];
}

/** Best-effort class-name extraction for the `<client>_error=` breadcrumb --
 * non-Error throws (rare, but `Innertube.create`/`getInfo` are third-party)
 * fall back to a fixed label instead of crashing the breadcrumb path itself.
 * When the thrown value is an Error, the first 100 chars of its `message`
 * (newlines stripped, single-lined) are appended after a `:` so device logs
 * distinguish library bugs from schema drift without another ship cycle. */
function errorClassName(err: unknown): string {
  if (err instanceof Error) {
    const msg = (err.message ?? '').slice(0, 100).replace(/[\r\n]+/g, ' ');
    return msg ? `${err.constructor.name}:${msg}` : err.constructor.name;
  }
  return 'UnknownError';
}

/**
 * Retries the timedtext fetch through a single alternate Innertube client
 * tier (TV/TVHTML5, ANDROID_VR). Emits a `<client>_tracks=N` breadcrumb
 * right after `getInfo` so on-device logs surface which tier had
 * caption_tracks available -- tightens future diagnostics without another
 * ship cycle. Throws the standard NO_CAPTIONS sentinel message whenever this
 * tier has nothing usable (empty tracks, no base_url, or empty srv1 body);
 * callers chain tiers by catching this and moving to the next one.
 *
 * s161 fix: `getClientCaptionTracks` (Innertube.create + getInfo) can throw
 * before the `<client>_tracks=N` breadcrumb is ever emitted -- s160 device
 * logs showed every non-WEB tier going straight from its `timedtext_empty_retry_*`
 * enter-marker to the NEXT tier's enter-marker (or to `no_captions_found`),
 * with no `_tracks=` breadcrumb in between and no signal for WHY. Wrap the
 * call so a pre-emit throw still surfaces a `<client>_error=<ErrorClass>`
 * breadcrumb before the tier is abandoned; the outer per-tier catch in
 * `fetchTranscript` still advances to the next tier exactly as before.
 */
async function retryViaClient(
  clientType: RetryClientType,
  videoId: string,
  fetchImpl: typeof fetch,
  onBreadcrumb: Breadcrumb,
  customFetch?: typeof fetch
): Promise<TranscriptLine[]> {
  const meta = RETRY_TIER_META[clientType];
  let tracks: CaptionTrackLike[];
  try {
    tracks = await getClientCaptionTracks(clientType, videoId, customFetch);
  } catch (err) {
    onBreadcrumb(`${clientType.toLowerCase()}_error=${errorClassName(err)}`);
    throw err;
  }
  onBreadcrumb(`${meta.tracksLabel}=${tracks.length}`);

  const track = pickCaptionTrack(tracks);
  const baseUrl = track?.base_url;
  if (!baseUrl) {
    throw noCaptionsError();
  }

  const lines = await fetchTimedtextLines(baseUrl, fetchImpl);
  if (lines.length === 0) {
    throw noCaptionsError();
  }
  return lines;
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
      // Chain through the alternate-client tiers in order -- TV (TVHTML5) ->
      // ANDROID_VR -- neither of which requires a pot for GVS/Player (yt-dlp
      // PO Token Guide, 2026; s162 Path A). ANDROID and IOS were dropped from
      // this chain -- both require a pot for GVS/Player, so retrying through
      // them was futile. If every tier comes back empty or errors, surface
      // the standard "no captions" message.
      let retrievedViaTier = false;
      for (const clientType of RETRY_CLIENT_ORDER) {
        const meta = RETRY_TIER_META[clientType];
        onBreadcrumb(meta.enterBreadcrumb);
        try {
          lines = await retryViaClient(clientType, videoId, fetchImpl, onBreadcrumb, customFetch);
          retrievedViaTier = true;
          break;
        } catch {
          // This tier had nothing usable (empty tracks, no base_url, empty
          // body, or any other failure -- Innertube.create rejection, fetch
          // error). Any such failure is masked as "try the next tier"; the
          // caller only sees the final "no captions" message once every tier
          // has been exhausted.
        }
      }

      if (!retrievedViaTier) {
        onBreadcrumb('no_captions_found');
        throw new Error(NO_CAPTIONS_MESSAGE);
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
