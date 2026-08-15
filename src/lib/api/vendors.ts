import { supabase } from "../supabase";
import { must } from "./helpers";
import type { Vendor, VendorOrderWithVendor } from "../types";
import type { WaOrderLine } from "../whatsapp";

export async function fetchVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .order("name");
  return must(data, error);
}

export async function createVendor(input: {
  name: string;
  whatsapp_number: string;
  notes?: string | null;
}): Promise<Vendor> {
  const { data, error } = await supabase
    .from("vendors")
    .insert(input)
    .select()
    .single();
  return must(data, error);
}

export async function updateVendor(
  id: string,
  patch: Partial<Pick<Vendor, "name" | "whatsapp_number" | "notes" | "is_active">>,
): Promise<Vendor> {
  const { data, error } = await supabase
    .from("vendors")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return must(data, error);
}

/**
 * Record a vendor order: snapshot of the exact WhatsApp message + its lines.
 * The snapshot is the audit answer to "what did we actually order that day?".
 * Orders are per branch (0013), so the store is part of the record.
 */
export async function recordVendorOrder(
  cycleId: string,
  vendorId: string,
  storeId: string,
  message: string,
  lines: (WaOrderLine & { item_id: string })[],
): Promise<void> {
  const { data: order, error } = await supabase
    .from("vendor_orders")
    .insert({
      cycle_id: cycleId,
      vendor_id: vendorId,
      store_id: storeId,
      message_snapshot: message,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();
  const created = must(order, error);

  const { error: linesError } = await supabase.from("vendor_order_items").insert(
    lines.map((l) => ({
      vendor_order_id: created.id,
      item_id: l.item_id,
      total_qty: l.qty,
      unit: l.unit,
    })),
  );
  must(true, linesError);
}

export async function fetchVendorOrders(
  cycleId: string,
): Promise<VendorOrderWithVendor[]> {
  const { data, error } = await supabase
    .from("vendor_orders")
    .select("*, vendor:vendors(id,name,whatsapp_number), store:stores(id,name)")
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false })
    .returns<VendorOrderWithVendor[]>();
  return must(data, error);
}
