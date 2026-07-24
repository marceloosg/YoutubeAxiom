// Dynamic Expo config wraps app.json's static config so the built app can
// carry the exact commit SHA it was built from (Marcelo msg 7133: "print
// version commit on app header just for me to make sure i am exec the right
// version"). Expo v49+ (this repo runs expo ~57) prefers app.config.js over
// app.json when both are present, on both `expo prebuild` and EAS build --
// app.json stays as the static source of truth for the rest of the config.
const { execSync } = require('node:child_process');
const app = require('./app.json');

let commitSha = 'local';
try {
  commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // Not a git checkout (e.g. inside a CI artifact extraction) -- leave as 'local'.
}

module.exports = {
  ...app,
  expo: {
    ...app.expo,
    extra: {
      ...app.expo.extra,
      commitSha,
      // v1.0.11 shipped the LightRAG Ingest/Ask UI (App.tsx s172 wire-up) but
      // lightragBaseUrl + lightragSecret in app.json are placeholder values;
      // editing them directly would leak the real secret into git history.
      // Read from build-time env vars instead -- Marcelo sets EAS secrets:
      //   eas secret:create --scope project --name LIGHTRAG_BASE_URL --value http://<ec2-ip>:8738
      //   eas secret:create --scope project --name LIGHTRAG_SECRET   --value <65B secret from /home/ubuntu/.axiom/lightrag_hmac_secret on axiom EC2>
      // Non-empty env-var wins; empty/unset falls back to app.json placeholder
      // so the existing error path still fires clearly (matches the pattern
      // already used for commitSha above).
      lightragBaseUrl: process.env.LIGHTRAG_BASE_URL || app.expo.extra.lightragBaseUrl,
      lightragSecret: process.env.LIGHTRAG_SECRET || app.expo.extra.lightragSecret,
      // s176-follow: same env-var wiring pattern for the Path K
      // axiom-yt-transcript backend proxy (port 8737). Marcelo sets EAS secrets:
      //   eas secret:create --scope project --name YT_TRANSCRIPT_BASE_URL --value http://<ec2-ip>:8737
      //   eas secret:create --scope project --name YT_TRANSCRIPT_SECRET   --value <secret from AXIOM_YT_SECRET on axiom EC2>
      // Non-empty env-var wins; empty/unset falls back to app.json placeholder,
      // which keeps the backend-proxy tier silently skipped (see
      // src/backend/ytTranscriptProxy.ts's getBackendProxyConfig).
      ytTranscriptBaseUrl: process.env.YT_TRANSCRIPT_BASE_URL || app.expo.extra.ytTranscriptBaseUrl,
      ytTranscriptSecret: process.env.YT_TRANSCRIPT_SECRET || app.expo.extra.ytTranscriptSecret,
    },
  },
};
