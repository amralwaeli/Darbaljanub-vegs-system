import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { authStorage } from "./native/storage";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env",
  );
}

// Only the anon key ships to the browser. It is safe to expose because every
// table is RLS default-deny; the key alone grants nothing.
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Invite / recovery links land with tokens in the URL hash — let the
    // client pick the session up automatically on /accept-invite.
    detectSessionInUrl: true,
    // In the APK the session lives in native storage, which Android does not
    // evict; on the web this is undefined and supabase-js keeps its own
    // localStorage default. See native/storage.ts for why.
    ...(authStorage ? { storage: authStorage } : {}),
  },
});

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;
