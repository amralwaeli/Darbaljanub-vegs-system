/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_CURRENCY?: string;
  readonly VITE_INACTIVITY_HOURS?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** Where the APK fetches OTA bundles from. See src/lib/native/updater.ts. */
  readonly VITE_OTA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
