import { supabase } from "../supabase";
import { must, maybe } from "./helpers";
import type {
  AggregatedItem,
  StoreRequestFull,
  RequestItem,
  StoreRequest,
} from "../types";
import type { Database } from "../database.types";

const FULL_SELECT =
  "*, store:stores(id,name), request_items(*, item:items(id,name,emoji,default_unit))";

/**
 * Manager/superadmin: every store's request in a cycle, with lines.
 * SUBMITTED only — a draft is a list the store is still building, and it must
 * not reach the aggregate the manager orders against.
 */
export async function fetchAllRequests(
  cycleId: string,
): Promise<StoreRequestFull[]> {
  const { data, error } = await supabase
    .from("store_requests")
    .select(FULL_SELECT)
    .eq("cycle_id", cycleId)
    .eq("status", "SUBMITTED")
    .order("created_at")
    .returns<StoreRequestFull[]>();
  return must(data, error);
}

/** PIC: own store's request in a cycle (RLS scopes it anyway). */
export async function fetchStoreRequest(
  cycleId: string,
  storeId: string,
): Promise<StoreRequestFull | null> {
  const { data, error } = await supabase
    .from("store_requests")
    .select(FULL_SELECT)
    .eq("cycle_id", cycleId)
    .eq("store_id", storeId)
    .maybeSingle<StoreRequestFull>();
  return maybe(data, error);
}

export async function createStoreRequest(
  cycleId: string,
  storeId: string,
  userId: string,
): Promise<StoreRequest> {
  const { data, error } = await supabase
    .from("store_requests")
    .insert({ cycle_id: cycleId, store_id: storeId, created_by: userId })
    .select()
    .single();
  return must(data, error);
}

/**
 * Send the finished list to the manager. One-way (enforced by
 * store_requests_guard): after this the PIC cannot edit, and the push
 * notification to managers fires off this transition.
 */
export async function submitStoreRequest(id: string): Promise<StoreRequest> {
  const { data, error } = await supabase
    .from("store_requests")
    .update({ status: "SUBMITTED" })
    .eq("id", id)
    .select()
    .single();
  return must(data, error);
}

/**
 * Manager/superadmin: get the store's request for this cycle, creating it if
 * the store never sent one. SECURITY DEFINER server-side (0013) because the
 * insert policy on store_requests is PIC-scoped.
 */
export async function managerRequestForStore(
  cycleId: string,
  storeId: string,
): Promise<StoreRequest> {
  const { data, error } = await supabase.rpc("manager_request_for_store", {
    p_cycle_id: cycleId,
    p_store_id: storeId,
  });
  return must<StoreRequest>(data, error);
}

export async function addRequestItem(input: {
  store_request_id: string;
  item_id: string;
  requested_qty: number;
  unit: string;
}): Promise<RequestItem> {
  const { data, error } = await supabase
    .from("request_items")
    .insert(input)
    .select()
    .single();
  return must(data, error);
}

export async function updateRequestItem(
  id: string,
  patch: Database["public"]["Tables"]["request_items"]["Update"],
): Promise<RequestItem> {
  const { data, error } = await supabase
    .from("request_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return must(data, error);
}

export async function deleteRequestItem(id: string): Promise<void> {
  const { error } = await supabase.from("request_items").delete().eq("id", id);
  must(true, error);
}

/**
 * Aggregated manager view: same item summed across stores.
 * Grouped by item AND unit — 10 kg + 2 boxes must never silently add up.
 */
export function aggregateRequests(
  requests: StoreRequestFull[],
): AggregatedItem[] {
  const map = new Map<string, AggregatedItem>();
  for (const req of requests) {
    for (const line of req.request_items) {
      const key = `${line.item_id}|${line.unit}`;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          item_id: line.item_id,
          name: line.item.name,
          emoji: line.item.emoji,
          unit: line.unit,
          total_qty: 0,
          perStore: [],
        };
        map.set(key, agg);
      }
      agg.total_qty += Number(line.requested_qty);
      agg.perStore.push({
        store_id: req.store_id,
        store_name: req.store.name,
        qty: Number(line.requested_qty),
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
