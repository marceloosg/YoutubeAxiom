import { loadSecret, signBody, SIGNATURE_HEADER } from '../auth/hmac';
import Constants from 'expo-constants';

export interface TranscriptPostBody {
  video_id: string;
  transcript_text: string;
  breadcrumbs: string[];
}

function getBackendUrl(): string {
  const url = Constants.expoConfig?.extra?.backendUrl as string | undefined;
  if (!url) {
    throw new Error(
      'BACKEND_URL not configured. Set `extra.backendUrl` in app.json / eas.json.'
    );
  }
  return url;
}

/**
 * POSTs the transcript payload to the backend `/yt-transcript` endpoint.
 * Backend contract is unchanged from the Kotlin app: HMAC-SHA256 signature of
 * the raw JSON body, hex-encoded, carried in the `X-Axiom-Signature` header.
 * Handled server-side by `telegram_inbound_lambda.py:handle_yt_transcript_post`.
 */
export async function postTranscript(body: TranscriptPostBody): Promise<Response> {
  const secret = await loadSecret();
  if (!secret) {
    throw new Error(
      'HMAC secret not configured. Set it via the in-app config screen or ' +
        '`extra.webhookSecret` in app.json / eas.json.'
    );
  }

  const backendUrl = getBackendUrl();
  const jsonBody = JSON.stringify(body);
  const signature = signBody(secret, jsonBody);

  const response = await fetch(`${backendUrl.replace(/\/$/, '')}/yt-transcript`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [SIGNATURE_HEADER]: signature,
    },
    body: jsonBody,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Backend POST failed: ${response.status} ${text}`);
  }

  return response;
}
