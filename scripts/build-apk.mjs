// ============================================================================
// Build the signed release APK.
//
//   npm run android:apk
//
// This is the ONLY step that produces something staff must install by hand,
// and it should be rare: day-to-day code changes ship over the air instead
// (see scripts/make-ota-bundle.mjs). Rebuild the APK only when the native
// shell itself changes — a new Capacitor plugin, a new permission, a new icon.
// ============================================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const androidDir = path.join(root, "android");
const isWindows = process.platform === "win32";

// ---------------------------------------------------------------- the JDK --
// Gradle 8.14 cannot parse class files from JDK 22+. A machine with a current
// JDK on PATH (this one has 25) fails with a bewildering
// "Unsupported class file major version 69", so pick a supported JDK here
// rather than making the next person debug it.
const JDK_MIN = 17;
const JDK_MAX = 21;

function javaMajor(home) {
  const binary = path.join(home, "bin", isWindows ? "java.exe" : "java");
  if (!fs.existsSync(binary)) return null;
  const out = spawnSync(binary, ["-version"], { encoding: "utf8" });
  // e.g. openjdk version "21.0.10" 2026-01-20
  const match = /version "(\d+)/.exec((out.stderr ?? "") + (out.stdout ?? ""));
  return match ? Number(match[1]) : null;
}

function findJdk() {
  const candidates = [
    process.env.CAPACITOR_JAVA_HOME,
    process.env.JAVA_HOME,
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    "/usr/lib/jvm/java-21-openjdk-amd64",
    "/usr/lib/jvm/java-17-openjdk-amd64",
    path.join(os.homedir(), ".bubblewrap", "jdk", "jdk-17.0.11+9"),
  ].filter(Boolean);

  for (const home of candidates) {
    const major = javaMajor(home);
    if (major !== null && major >= JDK_MIN && major <= JDK_MAX) {
      return { home, major };
    }
  }
  return null;
}

const jdk = findJdk();

function run(command, args, cwd = root) {
  const env = { ...process.env };
  if (jdk) env.JAVA_HOME = jdk.home;
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
    cwd,
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// A release APK signed with a DIFFERENT key than the installed app cannot be
// installed over it — Android rejects it and the only fix is uninstalling on
// every phone. Fail loudly rather than produce that APK.
const keystoreProps = path.join(androidDir, "keystore.properties");
if (!fs.existsSync(keystoreProps)) {
  console.error(
    "\nandroid/keystore.properties is missing.\n\n" +
      "Copy android/keystore.properties.example to android/keystore.properties\n" +
      "and fill in the password for twa/android.keystore.\n\n" +
      "Without it Gradle signs with the debug key, and the result WILL NOT\n" +
      "install over the app already on your staff's phones.\n",
  );
  process.exit(1);
}

// A copied-but-unedited template fails deep inside Gradle with a confusing
// "keystore password was incorrect". Catch it here instead.
if (/CHANGE_ME/.test(fs.readFileSync(keystoreProps, "utf8"))) {
  console.error(
    "\nandroid/keystore.properties still contains CHANGE_ME.\n\n" +
      "Replace both CHANGE_ME values with the keystore password\n" +
      "(it is in twa/keystore-password.txt).\n",
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(androidDir, "app", "google-services.json"))) {
  console.warn(
    "\nWARNING: android/app/google-services.json not found.\n" +
      "The APK will build and run, but notifications will not arrive.\n" +
      "Add the file from your Firebase project, then rebuild.\n",
  );
}

if (jdk) {
  console.log(`Using JDK ${jdk.major} at ${jdk.home}`);
} else {
  console.warn(
    `\nWARNING: no JDK between ${JDK_MIN} and ${JDK_MAX} found.\n` +
      "Gradle will use whatever java is on PATH, which fails with\n" +
      '"Unsupported class file major version" on JDK 22+.\n' +
      "Install a JDK 17-21 (Android Studio ships one) or set\n" +
      "CAPACITOR_JAVA_HOME to point at it.\n",
  );
}

console.log("\n[1/3] Building web bundle (base '/')...");
run("node", ["scripts/build-native.mjs"]);

console.log("\n[2/3] Syncing native project...");
run("npx", ["cap", "sync", "android"]);

console.log("\n[3/3] Assembling release APK...");
run(isWindows ? "gradlew.bat" : "./gradlew", ["assembleRelease"], androidDir);

const apk = path.join(
  androidDir,
  "app", "build", "outputs", "apk", "release", "app-release.apk",
);
if (fs.existsSync(apk)) {
  const mb = (fs.statSync(apk).size / 1024 / 1024).toFixed(1);
  console.log(`\nAPK ready (${mb} MB):\n  ${apk}\n\nSend this to staff once. Everything after ships over the air.`);
} else {
  console.error("\nBuild finished but no APK was found at the expected path.");
  process.exit(1);
}
