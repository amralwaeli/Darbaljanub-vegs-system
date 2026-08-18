// ============================================================================
// Native shell behaviour — the "stop feeling like a browser" work.
//
// In the TWA the app wore Chrome's chrome: a visible custom-tab bar, browser
// back-button semantics that walked out of the app, and a white flash on cold
// start. These are the OS-level equivalents.
// ============================================================================

import { nativeOnly } from "./index";

/** Matches theme_color in the web manifest / Tailwind green-700. */
const THEME_GREEN = "#15803d";

/**
 * Paint the status bar in the app's own colour instead of leaving a stock
 * black bar floating above an Arabic green UI.
 */
async function initStatusBar(): Promise<void> {
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  // Style.Dark = dark background, light glyphs — correct for green-700.
  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setBackgroundColor({ color: THEME_GREEN });
  await StatusBar.setOverlaysWebView({ overlay: false });
}

/**
 * Hardware back button.
 *
 * Capacitor's default is to close the app on any back press, which loses a
 * driver's place. This walks the router history instead, and only exits from
 * the root screen — what a native app does.
 */
async function initBackButton(): Promise<void> {
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}

/** Dismiss the native splash once React has actually painted. */
async function hideSplash(): Promise<void> {
  const { SplashScreen } = await import("@capacitor/splash-screen");
  await SplashScreen.hide();
}

/**
 * Run once at startup. Each step is independently guarded: a plugin that
 * misbehaves on some OEM ROM must cost us that one nicety, never the app.
 */
export async function initNativeShell(): Promise<void> {
  await nativeOnly("statusBar", initStatusBar);
  await nativeOnly("backButton", initBackButton);
  await nativeOnly("splashScreen", hideSplash);
}

/**
 * Subscribe to real connectivity changes.
 *
 * navigator.onLine inside a WebView reports the WebView's opinion, which on
 * Android is frequently stale — it can claim "online" on a phone with no
 * signal, which is exactly when the offline queue must not try to flush.
 * Returns a cleanup function, or null on the web where the caller keeps using
 * the browser events.
 */
export async function onNetworkRestored(
  handler: () => void,
): Promise<(() => void) | null> {
  const { isNative } = await import("./index");
  if (!isNative) return null;
  try {
    const { Network } = await import("@capacitor/network");
    const listener = await Network.addListener("networkStatusChange", (status) => {
      if (status.connected) handler();
    });
    return () => void listener.remove();
  } catch (e) {
    console.error("[native] network listener failed", e);
    return null;
  }
}
