// ============================================================================
// Session storage adapter.
//
// WHY THIS EXISTS: in the old TWA the Supabase session lived in Chrome's
// localStorage, which Android evicts under storage pressure — staff were
// silently logged out mid-shift. Inside the APK the session instead lives in
// native SharedPreferences, which belongs to the app and is not evicted.
//
// Supabase accepts an async storage adapter, which is what Preferences is.
// ============================================================================

import { isNative } from "./index";

/** Matches the shape supabase-js expects for `auth.storage`. */
export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Loaded once, lazily — never pulled into the web bundle.
let preferencesPromise: Promise<typeof import("@capacitor/preferences")> | null =
  null;

function preferences() {
  preferencesPromise ??= import("@capacitor/preferences");
  return preferencesPromise;
}

const nativeStorage: AsyncStorageAdapter = {
  async getItem(key) {
    const { Preferences } = await preferences();
    return (await Preferences.get({ key })).value;
  },
  async setItem(key, value) {
    const { Preferences } = await preferences();
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    const { Preferences } = await preferences();
    await Preferences.remove({ key });
  },
};

/**
 * The storage supabase-js should use for the auth session.
 *
 * `undefined` on the web, which makes supabase-js fall back to its own
 * localStorage default — the website keeps its current behavior untouched.
 */
export const authStorage: AsyncStorageAdapter | undefined = isNative
  ? nativeStorage
  : undefined;
