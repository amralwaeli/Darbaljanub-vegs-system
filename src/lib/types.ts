// Domain-level composed types for embedded (joined) query results.
// Used with .returns<T>() on Supabase queries that embed related rows.

import type { Tables, UserRole } from "./database.types";

export type Profile = Tables<"profiles">;
export type Store = Tables<"stores">;
export type Item = Tables<"items">;
export type Vendor = Tables<"vendors">;
export type OrderCycle = Tables<"order_cycles">;
export type StoreRequest = Tables<"store_requests">;
export type RequestItem = Tables<"request_items">;
export type Delivery = Tables<"deliveries">;
export type VendorOrder = Tables<"vendor_orders">;
export type AuditEntry = Tables<"audit_log">;

/** request_items with its catalog item embedded */
export type RequestItemWithItem = RequestItem & {
  item: Pick<Item, "id" | "name" | "emoji" | "default_unit">;
};

/** A store request with store info + all lines (manager + PIC screens) */
export type StoreRequestFull = StoreRequest & {
  store: Pick<Store, "id" | "name">;
  request_items: RequestItemWithItem[];
};

/** Delivery with its store embedded (driver + PIC screens) */
export type DeliveryWithStore = Delivery & {
  store: Pick<Store, "id" | "name" | "address">;
};

/** Profile with assigned store name (users admin screen) */
export type ProfileWithStore = Profile & {
  store: Pick<Store, "id" | "name"> | null;
};

export type VendorOrderWithVendor = VendorOrder & {
  vendor: Pick<Vendor, "id" | "name" | "whatsapp_number">;
};

/** Aggregated line for the manager's cross-store view */
export interface AggregatedItem {
  item_id: string;
  name: string;
  emoji: string | null;
  unit: string;
  total_qty: number;
  perStore: { store_id: string; store_name: string; qty: number }[];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: "Super Admin",
  manager: "Manager",
  pic: "Store PIC",
  driver: "Driver",
};

export const UNITS = ["kg", "box", "bag", "piece", "bunch", "carton"] as const;
