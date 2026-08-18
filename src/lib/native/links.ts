// ============================================================================
// Opening things outside the app — in practice, WhatsApp.
//
// WHY THIS EXISTS: sending the day's order to a market vendor is a core
// workflow, and `window.open("https://wa.me/...", "_blank")` is not dependable
// inside an Android WebView — depending on the ROM it can be swallowed
// silently, or land in a browser tab that shows a "Continue to WhatsApp"
// interstitial instead of opening the app.
//
// AppLauncher fires a real Android Intent, so the OS hands the link straight to
// WhatsApp exactly as it would from any other native app.
// ============================================================================

import { isNative } from "./index";

/** True when links must be handed to the OS rather than followed in place. */
export const needsNativeLinkHandling = isNative;

/**
 * Open a URL outside the app.
 *
 * On the web this is the plain window.open the app has always used. On native
 * it becomes an Intent, falling back to window.open if the launch is refused
 * (e.g. WhatsApp is not installed) so the user still gets somewhere useful.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isNative) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    const { AppLauncher } = await import("@capacitor/app-launcher");
    await AppLauncher.openUrl({ url });
  } catch (e) {
    console.error("[links] native open failed, falling back", e);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
