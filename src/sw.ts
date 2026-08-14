/// <reference lib="webworker" />
// ============================================================================
// Custom service worker (vite-plugin-pwa injectManifest mode).
// Replicates the auto-update behavior generateSW gave us (precache +
// skipWaiting + clientsClaim + SPA navigation fallback) and adds Web Push.
// ============================================================================

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

// --- auto-update: new versions activate immediately, silently --------------
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback ("index.html" resolves against the SW scope, so it
// works at "/" and at "/<repo>/" on GitHub Pages alike). Supabase API calls
// are cross-origin and never touch this cache.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/functions\//],
  }),
);

// --- Web Push ---------------------------------------------------------------
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = (event.data?.json() as PushPayload) ?? {};
  } catch {
    /* non-JSON push — show generic */
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "خضار درب الجنوب", {
      body: data.body ?? "",
      icon: `${self.registration.scope}icons/icon-192.png`,
      badge: `${self.registration.scope}icons/icon-192.png`,
      dir: "rtl",
      lang: "ar",
      data: { url: data.url ?? self.registration.scope },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data as { url?: string } | undefined)?.url ??
    self.registration.scope;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an existing app window if one is open, else open a new one.
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope)) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
