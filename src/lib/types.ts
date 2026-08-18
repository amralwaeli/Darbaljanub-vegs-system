// Domain-level composed types for embedded (joined) query results.
// Used with .returns<T>() on Supabase queries that embed related rows.

import type { Tables } from "./database.types";

export type Profile = Tables<"profiles">;
export type Store = Tables<"stores">;
export type Item = Tables<"items">;
export type Vendor = Tables<"vendors">;
export type Category = Tables<"categories">;
export type OrderCycle = Tables<"order_cycles">;
export type StoreRequest = Tables<"store_requests">;
export type RequestItem = Tables<"request_items">;
export type Delivery = Tables<"deliveries">;
export type VendorOrder = Tables<"vendor_orders">;
export type AuditEntry = Tables<"audit_log">;

/** request_items with its catalog item embedded */
export type RequestItemWithItem = RequestItem & {
  // category_id rides along so the manager's screens can group lines without
  // a second round trip to the catalogue.
  item: Pick<Item, "id" | "name" | "emoji" | "default_unit" | "category_id">;
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
  vendor: Pick<Vendor, "id" | "name" | "whatsapp_number" | "category_id">;
  /** Null for orders placed before 0013, which were aggregated across stores. */
  store: { id: string; name: string } | null;
};

/** Aggregated line for the manager's cross-store view */
export interface AggregatedItem {
  item_id: string;
  name: string;
  emoji: string | null;
  unit: string;
  /** 0019 — null when the item has not been filed under a category yet. */
  category_id: string | null;
  total_qty: number;
  perStore: { store_id: string; store_name: string; qty: number }[];
}

/**
 * A group of lines under one category, for the manager's screens.
 *
 * `category` is null for the "غير مصنف" bucket, which exists so an item the
 * manager has not filed yet can never silently vanish from the order.
 */
export interface CategoryGroup<T> {
  category: Category | null;
  lines: T[];
}

// Role display labels live in i18n (t.roles) — translated like everything else.

export const UNITS = ["kg", "box", "bag", "piece", "bunch", "carton"] as const;
