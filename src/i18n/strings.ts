// ============================================================================
// Language selector. ARABIC IS THE DEFAULT (all staff are Arabic speakers);
// English is available via the header/login toggle. The choice persists in
// localStorage and switching reloads the app (instant — the shell is cached
// by the service worker), which keeps every component a simple `t.key` read
// with zero re-render plumbing.
// ============================================================================

import { en } from "./en";
import { ar } from "./ar";

export type Strings = typeof en;
export type Lang = "en" | "ar";

const STORAGE_KEY = "vegs.lang";

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "ar" ? stored : "ar";
  } catch {
    return "ar";
  }
}

export const LANG: Lang = readLang();
export const IS_RTL = LANG === "ar";

export const t: Strings = IS_RTL ? ar : en;

export const CURRENCY = import.meta.env.VITE_CURRENCY ?? "$";

export function toggleLanguage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, IS_RTL ? "en" : "ar");
  } catch {
    /* private mode — toggle still works for this load */
  }
  location.reload();
}
