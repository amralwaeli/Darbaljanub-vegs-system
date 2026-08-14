import { CURRENCY, LANG } from "../i18n/strings";

// Format in the UI's language, not the device's. A phone left on en-US was
// showing "Aug 14, 2026" in the middle of an otherwise Arabic screen.
// "ar" (not "ar-EG" etc.) keeps Western digits, which is what the staff read
// prices and quantities in.
const LOCALE = LANG === "ar" ? "ar" : "en";

export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${CURRENCY}${value.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtQty(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const n = value.toLocaleString(LOCALE, { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
