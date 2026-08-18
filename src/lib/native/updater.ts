// ============================================================================
// Over-the-air updates — the reason the APK is installed exactly once.
//
// HOW IT WORKS
//   CI builds the web bundle on every push to main, zips it, and publishes it
//   next to the website as:
//       <OTA_BASE>/latest.json     { version, url, checksum }
//       <OTA_BASE>/bundle-<v>.zip
//   The app fetches that manifest, and when the version differs from what it
//   is running it downloads the zip and STAGES it with next() — the new code
//   takes effect on the next cold start.
//
// WHY next() AND NOT set(): set() swaps the bundle and reloads immediately.
// Doing that to a driver halfway through logging a delivery would wipe
// in-progress UI state. Staging costs one app restart and is never disruptive.
//
// SAFETY: notifyAppReady() is called first thing on every launch. If a bundle
// we ship is broken enough that this line is never reached, the plugin rolls
// back to the last working bundle by itself (appReadyTimeout in
// capacitor.config.ts). A bad deploy cannot brick the phones.
//
// The website ignores all of this — it keeps updating via its service worker.
// ============================================================================

import { isNative } from "./index";

interface UpdateManifest {
  version: string;
  url: string;
  checksum?: string;
}

type UpdaterModule = typeof import("@capgo/capacitor-updater");

let modulePromise: Promise<UpdaterModule> | null = null;
function updater(): Promise<UpdaterModule> {
  modulePromise ??= import("@capgo/capacitor-updater");
  return modulePromise;
}

// Where CI publishes the bundles. Defaults to the GitHub Pages site that also
// serves the website, so there is one deploy pipeline and no hosting bill.
const OTA_BASE = (
  import.meta.env.VITE_OTA_URL ??
  "https://amralwaeli.github.io/Darbaljanub-vegs-system/ota"
).replace(/\/$/, "");

/** Don't hammer the network when the app is foregrounded repeatedly. */
const MIN_CHECK_INTERVAL_MS = 15 * 60 * 1000;
let lastCheck = 0;

/**
 * Tell the plugin this bundle booted successfully, cancelling the rollback
 * timer. Must run on EVERY launch, before anything that can throw.
 */
export async function markLaunchSuccessful(): Promise<void> {
  if (!isNative) return;
  try {
    const { CapacitorUpdater } = await updater();
    await CapacitorUpdater.notifyAppReady();
  } catch (e) {
    console.error("[ota] notifyAppReady failed", e);
  }
}

/**
 * Remove bundles that are neither running nor staged, so a phone that has
 * updated for a year does not accumulate a folder of dead zips.
 */
async function pruneOldBundles(keep: Set<string>): Promise<void> {
  try {
    const { CapacitorUpdater } = await updater();
    const { bundles } = await CapacitorUpdater.list();
    for (const bundle of bundles) {
      if (!keep.has(bundle.id) && bundle.status !== "success") {
        await CapacitorUpdater.delete({ id: bundle.id });
      }
    }
  } catch {
    /* housekeeping only — never worth surfacing */
  }
}

/**
 * Check for a newer bundle and stage it.
 *
 * Every failure path is silent: no network, a half-written manifest, a bad
 * zip — the app simply keeps running the bundle it already has. An update
 * mechanism must never be the thing that breaks the app.
 */
export async function checkForUpdate(force = false): Promise<void> {
  if (!isNative) return;

  const now = Date.now();
  if (!force && now - lastCheck < MIN_CHECK_INTERVAL_MS) return;
  lastCheck = now;

  try {
    const response = await fetch(`${OTA_BASE}/latest.json`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    const manifest = (await response.json()) as UpdateManifest;
    if (!manifest?.version || !manifest?.url) return;

    const { CapacitorUpdater } = await updater();
    const current = await CapacitorUpdater.current();

    // CI only ever publishes forward, so "different" means "newer" and we
    // avoid parsing version strings.
    if (current.bundle.version === manifest.version) return;

    // Already downloaded on an earlier run but not yet applied.
    const { bundles } = await CapacitorUpdater.list();
    const staged = bundles.find((b) => b.version === manifest.version);

    const bundle =
      staged ??
      (await CapacitorUpdater.download({
        url: manifest.url,
        version: manifest.version,
        ...(manifest.checksum ? { checksum: manifest.checksum } : {}),
      }));

    // Apply on next cold start, never mid-session.
    await CapacitorUpdater.next({ id: bundle.id });
    console.info(`[ota] staged ${manifest.version} for next launch`);

    await pruneOldBundles(new Set([bundle.id, current.bundle.id]));
  } catch (e) {
    console.error("[ota] update check failed", e);
  }
}
