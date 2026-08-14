import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./components/Toast";
import { initOfflineQueue } from "./lib/offlineQueue";
import { LANG, IS_RTL } from "./i18n/strings";
import "./index.css";

// Arabic (default) renders right-to-left across the whole app.
document.documentElement.lang = LANG;
document.documentElement.dir = IS_RTL ? "rtl" : "ltr";

// ---------------------------------------------------------------------------
// Auto-update: registerType "autoUpdate" swaps in new service workers
// silently. On top of the default launch check, we re-check for a new deploy
// every 60s AND whenever the app regains focus — a phone that stays open all
// day still picks up today's deploy within a minute.
// ---------------------------------------------------------------------------
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
