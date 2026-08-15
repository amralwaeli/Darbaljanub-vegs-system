// WhatsApp deep links — free, no Business API.
// wa.me requires the number in international format, digits only.

import { LANG, t } from "../i18n/strings";

export interface WaOrderLine {
  name: string;
  qty: number;
  unit: string;
}

/**
 * Order message for one BRANCH, sent to a market vendor over WhatsApp.
 *
 * Addressed to the branch, not the vendor: the vendor delivers to each shop, so
 * the shop name is the useful line — they already know who they are. One order
 * per branch, so the message never mixes two shops' goods.
 *
 * Name and quantity only. Units are not shown anywhere in the system; each item
 * carries a single unit fixed in the catalogue.
 */
export function buildVendorMessage(
  branchName: string,
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
        })}`,
    )
    .join("\n");
  return `*${t.waOrderTitle} — ${date}*\n${t.waTo}: ${branchName}\n\n${body}\n\n${t.waLineCount}: ${lines.length}\n${t.waFooter}`;
}

export function waLink(whatsappNumber: string, message: string): string {
  const digits = whatsappNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
