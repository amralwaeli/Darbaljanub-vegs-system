// WhatsApp deep links — free, no Business API.
// wa.me requires the number in international format, digits only.

export interface WaOrderLine {
  name: string;
  qty: number;
  unit: string;
}

/** Clean, copy-paste-friendly order message for one market vendor. */
export function buildVendorMessage(
  vendorName: string,
  lines: WaOrderLine[],
  cycleDate: string,
): string {
  const date = new Date(cycleDate).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const body = lines
    .map(
      (l) =>
        `• ${l.name} — ${l.qty.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} ${l.unit}`,
    )
    .join("\n");
  return `*Order — ${date}*\nTo: ${vendorName}\n\n${body}\n\nTotal lines: ${lines.length}\nPlease confirm availability. Thank you!`;
}

export function waLink(whatsappNumber: string, message: string): string {
  const digits = whatsappNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
