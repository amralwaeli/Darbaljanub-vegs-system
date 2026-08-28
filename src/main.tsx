import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./components/Toast";
import { initOfflineQueue } from "./lib/offlineQueue";
import { LANG, IS_RTL } from "./i18n/strings";
import { isNative } from "./lib/native/index";
import { initNativeShell } from "./lib/native/shell";
import {
  initNativePushListeners,
  requestNativePermission,
} from "./lib/native/push";
import { checkForUpdate, markLaunchSuccessful } from "./lib/native/updater";
import "./index.css";

// Arabic (default) renders right-to-left across the whole app.
document.documentElement.lang = LANG;
document.documentElement.dir = IS_RTL ? "rtl" : "ltr";

// ---------------------------------------------------------------------------
// Updates. Two platforms, two mechanisms, same promise: nobody ever reinstalls.
//
//   website — service worker, registerType "autoUpdate" (unchanged)
//   APK     — OTA bundles from CI, staged and applied on next launch
//
// The service worker is deliberately NOT registered inside the app: Capacitor
// already serves the bundle from local storage, and a second cache layer would
// fight the OTA swap for control of which code actually runs.
// ---------------------------------------------------------------------------
if (isNative) {
  // First, before anything that can throw: cancels the rollback timer that
  // would otherwise revert this bundle. See native/updater.ts.
  void markLaunchSuccessful().then(() => checkForUpdate(true));
} else {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => void registration.update(), 60_000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void registration.update();
        }
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Native shell: status bar, hardware back button, splash, notification taps.
// Every call is a no-op on the web.
// ---------------------------------------------------------------------------
if (isNative) {
  void initNativeShell();

  // Tapping a notification deep-links into the app. The payload carries an
  // app-relative path precisely so it does not depend on the website's
  // /<repo>/ base, which the APK does not have.
  //
  // Then ask for the notification permission immediately — notifications are
  // ON by default in this app, and the OS dialog belongs at first launch like
  // it does in every other Android app. Waiting for someone to discover the
  // bell in the header is why managers and drivers were unreachable for
  // weeks. Writing the token to the server happens later, on first sign-in
  // (AuthProvider -> Layout -> ensurePushRegistered), because there is no
  // session to attach it to yet.
  void initNativePushListeners((path) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }).then(() => requestNativePermission());

  // A phone left open all day still picks up today's deploy: re-check
  // whenever the app returns to the foreground (rate-limited internally).
  void import("@capacitor/app").then(({ App: CapApp }) => {
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void checkForUpdate();
    });
  });
}

initOfflineQueue();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
