// ============================================================================
// Build the web bundle for the NATIVE app (APK + OTA), as opposed to the
// website.
//
// The only difference that matters is the base path. The website is served
// from https://<user>.github.io/<repo>/ so it builds with BASE_PATH=/<repo>/,
// but the APK serves the same files from the WebView's own root. Building the
// native bundle with the website's base makes every asset 404 inside the app —
// a blank green screen with no error.
//
// This exists as a script (rather than an inline env var) so it behaves the
// same on Windows and on the CI runner.
// ============================================================================

import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, BASE_PATH: "/" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("npx", ["tsc", "-b"]);
run("npx", ["vite", "build"]);

console.log("\nNative bundle built at dist/ with base '/'");
