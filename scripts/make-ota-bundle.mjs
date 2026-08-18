// ============================================================================
// Package dist/ as an OTA update bundle.
//
// Produces, under ota/:
//   bundle-<version>.zip   the built web app (index.html at the ZIP ROOT)
//   latest.json            { version, url, checksum } — what the app polls
//
// CI runs this after `build:native` and publishes ota/ next to the website, so
// one push to main both updates the site and updates every installed phone.
//
// The version must be unique and move forward on every publish; the app treats
// "different from what I am running" as "newer" (CI only publishes forward).
// ============================================================================

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const root = process.cwd();
const distDir = path.join(root, "dist");
const otaDir = path.join(root, "ota");

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error(
    "dist/index.html missing — run `npm run build:native` first.\n" +
      "(The website build is NOT usable here: its base path is /<repo>/.)",
  );
  process.exit(1);
}

// --- version ---------------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function buildTag() {
  // GitHub Actions gives a monotonic run number; fall back to the commit sha
  // locally, and to a timestamp outside a repo.
  if (process.env.OTA_BUILD) return process.env.OTA_BUILD;
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return String(Date.now());
  }
}

const version = `${pkg.version}-${buildTag()}`;
const zipName = `bundle-${version}.zip`;

// --- zip -------------------------------------------------------------------
fs.rmSync(otaDir, { recursive: true, force: true });
fs.mkdirSync(otaDir, { recursive: true });

const zip = new AdmZip();
// addLocalFolder puts dist/'s CONTENTS at the zip root, which is the layout
// the updater plugin expects — it looks for index.html at the top level.
zip.addLocalFolder(distDir);
const zipPath = path.join(otaDir, zipName);
zip.writeZip(zipPath);

// --- manifest --------------------------------------------------------------
const bytes = fs.readFileSync(zipPath);
const checksum = createHash("sha256").update(bytes).digest("hex");

// Public location of ota/ once deployed. Must match VITE_OTA_URL in the APK.
const baseUrl = (
  process.env.OTA_PUBLIC_URL ??
  "https://amralwaeli.github.io/Darbaljanub-vegs-system/ota"
).replace(/\/$/, "");

fs.writeFileSync(
  path.join(otaDir, "latest.json"),
  `${JSON.stringify(
    { version, url: `${baseUrl}/${zipName}`, checksum, builtAt: new Date().toISOString() },
    null,
    2,
  )}\n`,
);

console.log(
  `OTA bundle ready\n` +
    `  version  ${version}\n` +
    `  size     ${(bytes.length / 1024).toFixed(0)} KB\n` +
    `  sha256   ${checksum}\n` +
    `  url      ${baseUrl}/${zipName}`,
);
