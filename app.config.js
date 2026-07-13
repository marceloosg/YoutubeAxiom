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
    },
  },
};
