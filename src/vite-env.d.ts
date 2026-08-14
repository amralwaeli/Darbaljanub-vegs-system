/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_CURRENCY?: string;
  readonly VITE_INACTIVITY_HOURS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
