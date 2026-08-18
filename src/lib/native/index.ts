// ============================================================================
// Platform layer.
//
// The SAME React app ships two ways: as the website (GitHub Pages) and as the
// native Android APK (Capacitor). Every capability that differs between the
// two lives behind a module in this folder, so feature code never branches on
// the platform itself.
//
// Rule followed throughout: `@capacitor/core` is imported statically (it is
// tiny and platform-safe), but the native PLUGINS are always loaded with a
// dynamic import() inside an `isNative` branch. That keeps them out of the web
// bundle entirely and guarantees the website behaves exactly as it does today.
// ============================================================================

import { Capacitor } from "@capacitor/core";

/** True only inside the Android APK — false on the website and in dev. */
export const isNative = Capacitor.isNativePlatform();

/** "android" | "ios" | "web" */
export const platform = Capacitor.getPlatform();

/**
 * Run a native-only side effect, swallowing any failure.
 *
 * Native init is never load-bearing: a plugin that throws on some OEM ROM must
 * degrade the app to "works, minus that one nicety" and never to a white
 * screen. Failures are logged because a phone in the field has no other trace.
 */
export async function nativeOnly(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  if (!isNative) return;
  try {
    await fn();
  } catch (e) {
    console.error(`[native] ${label} failed`, e);
  }
}
