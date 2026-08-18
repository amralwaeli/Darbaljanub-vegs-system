import { supabase } from "../supabase";
import { must } from "./helpers";
import type {
  AggregatedItem,
  Category,
  CategoryGroup,
  StoreRequestFull,
  RequestItem,
  StoreRequest,
} from "../types";
import type { Database } from "../database.types";

// category_id rides along on the embedded item so every manager screen can
// group by category without a second query (0019).
const FULL_SELECT =
  "*, store:stores(id,name), request_items(*, item:items(id,name,emoji,default_unit,category_id))";

/**
 * Manager/superadmin: every store's request in a cycle, with lines.
 * SUBMITTED only — a draft is a list the store is still building, and it must
 * not reach the aggregate the manager orders against.
 *
 * Since 0019 a branch may send MORE THAN ONE request per cycle (they forget
 * items), so this can return several rows per store. They are ordered by store
 * then `seq` so a follow-up order always reads as an addition to the first.
 */
export async function fetchAllRequests(
  cycleId: string,
): Promise<StoreRequestFull[]> {
  const { data, error } = await supabase
    .from("store_requests")
    .select(FULL_SELECT)
    .eq("cycle_id", cycleId)
    .eq("status", "SUBMITTED")
    .order("seq")
    .returns<StoreRequestFull[]>();

  // Sorted here, not in the query: ordering by store_id would sort by UUID,
  // i.e. arbitrarily. A branch's orders stay together and in send order.
  return [...must(data, error)].sort(
    (a, b) => a.store.name.localeCompare(b.store.name) || a.seq - b.seq,
  );
}

/**
 * PIC: this store's requests for a cycle, oldest send first (RLS scopes it).
 *
 * Returns a LIST because a branch may send several. At most one of them is a
 * DRAFT — the one they are currently building — enforced by the partial unique
 * index in 0019.
 */
export async function fetchStoreRequests(
  cycleId: string,
  storeId: string,
): Promise<StoreRequestFull[]> {
  const { data, error } = await supabase
    .from("store_requests")
    .select(FULL_SELECT)
    .eq("cycle_id", cycleId)
    .eq("store_id", storeId)
    .order("seq")
    .returns<StoreRequestFull[]>();
  return must(data, error);
}

/** The one editable list, if the branch has one open. */
export function draftOf(requests: StoreRequestFull[]): StoreRequestFull | null {
  return requests.find((r) => r.status === "DRAFT") ?? null;
}

/** Everything already sent, oldest first. */
export function sentOf(requests: StoreRequestFull[]): StoreRequestFull[] {
  return requests.filter((r) => r.status === "SUBMITTED");
}

/**
 * The branch's open draft, created if it has none.
 *
 * Server-side get-or-create rather than a plain INSERT: at most one draft may
 * exist per branch per cycle (0019), and a stale client cache would otherwise
 * turn a perfectly ordinary tap into a raw unique-constraint error. `seq` is
 * assigned by a trigger and is never sent from here.
 */
export async function ensureStoreDraft(
  cycleId: string,
  storeId: string,
): Promise<StoreRequest> {
  const { data, error } = await supabase.rpc("ensure_store_draft", {
    p_cycle_id: cycleId,
    p_store_id: storeId,
  });
  return must<StoreRequest>(data, error);
}

/**
 * Send the finished list to the manager. One-way (enforced by
 * store_requests_guard): after this the PIC cannot edit it, and the push
 * notification to managers fires off this transition.
 *
 * Since 0019 this is no longer the end of the branch's day: they may start a
 * fresh list afterwards for anything they forgot, and each send notifies the
 * manager again.
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

/** Manager/superadmin: drop a whole branch's request. Cascades to its lines. */
export async function deleteStoreRequest(id: string): Promise<void> {
  const { error } = await supabase.from("store_requests").delete().eq("id", id);
  must(true, error);
}

/**
 * Aggregated manager view: same item summed across stores.
 * Grouped by item AND unit — 10 kg + 2 boxes must never silently add up.
 *
 * A branch's follow-up orders (0019) fold into that branch's single figure
 * here: when buying, 5 kg then 3 kg of tomatoes is 8 kg. The per-branch tab is
 * where the two sends stay visible as separate orders.
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
          category_id: line.item.category_id,
          unit: line.unit,
          total_qty: 0,
          perStore: [],
        };
        map.set(key, agg);
      }
      agg.total_qty += Number(line.requested_qty);

      // Merge repeat sends from the same branch into one line rather than
      // listing that branch twice.
      const existing = agg.perStore.find((s) => s.store_id === req.store_id);
      if (existing) {
        existing.qty += Number(line.requested_qty);
      } else {
        agg.perStore.push({
          store_id: req.store_id,
          store_name: req.store.name,
          qty: Number(line.requested_qty),
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Split any list of lines into category buckets, in the manager's display
 * order, dropping categories that have nothing in them.
 *
 * Anything whose category is missing or deactivated lands in a trailing
 * `category: null` bucket. That bucket is deliberate: an unfiled item must
 * still be visible to buy, never silently dropped from the order.
 */
export function groupByCategory<T>(
  lines: T[],
  categories: Category[],
  categoryIdOf: (line: T) => string | null,
): CategoryGroup<T>[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const buckets = new Map<string, T[]>();

  for (const line of lines) {
    const id = categoryIdOf(line);
    const key = id && byId.has(id) ? id : "";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(line);
    else buckets.set(key, [line]);
  }

  const groups: CategoryGroup<T>[] = [];
  for (const category of categories) {
    const inCategory = buckets.get(category.id);
    if (inCategory?.length) groups.push({ category, lines: inCategory });
  }
  const unfiled = buckets.get("");
  if (unfiled?.length) groups.push({ category: null, lines: unfiled });
  return groups;
}
