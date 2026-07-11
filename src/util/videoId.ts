/**
 * Video ID extraction from YouTube URLs.
 *
 * Mirrors the Kotlin scraper's URL-parsing intent (concept transfer from
 * marceloosg/Axiom-yt-android). Supports:
 *   - https://www.youtube.com/watch?v=VIDEOID
 *   - https://youtube.com/watch?v=VIDEOID&t=30s (extra query params ignored)
 *   - https://youtu.be/VIDEOID
 *   - https://www.youtube.com/embed/VIDEOID
 *   - https://www.youtube.com/shorts/VIDEOID
 *   - Bare 11-char video ID (fallback, no URL wrapper)
 */

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts an 11-character YouTube video ID from a URL or bare ID string.
 * Returns null if no valid video ID can be found.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare video ID (no URL wrapper).
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    // Allow inputs missing a scheme (e.g. "youtu.be/abc123XYZ_").
    url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  // youtu.be/VIDEOID
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'music.youtube.com') {
    // /watch?v=VIDEOID
    const vParam = url.searchParams.get('v');
    if (vParam && VIDEO_ID_PATTERN.test(vParam)) {
      return vParam;
    }

    // /embed/VIDEOID or /shorts/VIDEOID or /live/VIDEOID
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(segments[0])) {
      const id = segments[1];
      return VIDEO_ID_PATTERN.test(id) ? id : null;
    }
  }

  return null;
}
