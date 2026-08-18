import type { CapacitorConfig } from "@capacitor/cli";

// ============================================================================
// Capacitor — the native Android shell around the same React app that ships as
// the website. Everything here concerns the APK only; `npm run build` alone
// still produces the plain web build.
//
// IMPORTANT — base path: the website is served from /<repo>/ on GitHub Pages,
// but the native WebView serves the bundle from its own root. The native and
// OTA builds must therefore be built WITHOUT BASE_PATH (see `build:native` in
// package.json), or every asset 404s inside the app.
// ============================================================================
const config: CapacitorConfig = {
  appId: "com.darbaljanub.vegs",
  appName: "درب الجنوب",
  webDir: "dist",

  android: {
    // Release APKs are signed from android/keystore.properties (gitignored).
    buildOptions: {
      keystorePath: "../twa/android.keystore",
      keystoreAlias: "android",
    },
  },

  plugins: {
    // --- OTA updates -------------------------------------------------------
    // Manual mode: we own the check/download/stage cycle in
    // src/lib/native/updater.ts so an update can never swap the UI out from
    // under a driver mid-delivery — it is staged and applied on next launch.
    //
    // appReadyTimeout is the safety net: if a downloaded bundle fails to boot
    // and call notifyAppReady() within 10s, the plugin rolls back to the last
    // known-good bundle by itself. A bad deploy cannot brick the phones.
    CapacitorUpdater: {
      autoUpdate: false,
      resetWhenUpdate: true,
      appReadyTimeout: 10000,
      directUpdate: false,
    },

    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor: "#f0fdf4",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },

    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },

    Keyboard: {
      resize: "body",
    },
  },
};

export default config;
