import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages: project sites live under /<repo-name>/. The deploy workflow
// (.github/workflows/deploy.yml) sets BASE_PATH automatically; local dev and
// root-domain deploys default to "/". Everything below (router, manifest,
// service worker, precache URLs) derives from this one value.
const base = process.env.BASE_PATH ?? "/";

// PWA notes:
//  * registerType "autoUpdate": new service worker activates immediately
//    (skipWaiting + clientsClaim) — users get new versions silently, no
//    reinstall ever.
//  * src/main.tsx additionally calls registerSW with a periodic + on-focus
//    update check, so long-lived installed apps pick up deploys fast.
//  * NO runtime caching of Supabase API responses: privacy first (prices must
//    never linger in a shared cache). Only the app shell is precached.
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "Darb Al-Janub Vegetables",
        short_name: "Vegs",
        description:
          "Multi-store vegetable procurement and distribution system",
        theme_color: "#15803d",
        background_color: "#f0fdf4",
        display: "standalone",
        orientation: "portrait",
        // Relative to the manifest location -> works at "/" AND "/<repo>/".
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        // Never intercept Supabase calls with the SW cache.
        navigateFallbackDenylist: [/^\/functions\//],
      },
    }),
  ],
  build: {
    sourcemap: false,
    target: "es2020",
  },
});
