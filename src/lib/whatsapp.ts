// WhatsApp deep links — free, no Business API.
// wa.me requires the number in international format, digits only.

import { LANG, t } from "../i18n/strings";

export interface WaOrderLine {
  name: string;
  qty: number;
  unit: string;
}

/**
 * Clean, copy-paste-friendly order message for one market vendor.
 *
 * Written in the UI language — the market vendors are Arabic speakers, so this
 * goes out in Arabic by default. Unlike the in-app lists, each line KEEPS its
 * unit: the vendor is the one person who has to know whether "5" means five
 * kilos or five boxes.
 */
export function buildVendorMessage(
  vendorName: string,
  lines: WaOrderLine[],
  cycleDate: string,
): string {
  const locale = LANG === "ar" ? "ar" : "en";
  const date = new Date(cycleDate).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
  const body = lines
    .map(
      (l) =>
        `• ${l.name} — ${l.qty.toLocaleString(locale, {
          maximumFractionDigits: 2,
        })} ${t.units[l.unit] ?? l.unit}`,
    )
    .join("\n");
  return `*${t.waOrderTitle} — ${date}*\n${t.waTo}: ${vendorName}\n\n${body}\n\n${t.waLineCount}: ${lines.length}\n${t.waFooter}`;
}

export function waLink(whatsappNumber: string, message: string): string {
  const digits = whatsappNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
