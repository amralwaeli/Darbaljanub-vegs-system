import { CURRENCY } from "../i18n/strings";

export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${CURRENCY}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtQty(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const n = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
