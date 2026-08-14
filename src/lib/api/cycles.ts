import { supabase } from "../supabase";
import { must, maybe } from "./helpers";
import type { OrderCycle } from "../types";
import type { CycleStatus } from "../database.types";

/**
 * The one cycle that is collecting requests. Since 0009 exactly one OPEN cycle
 * always exists; ensure_open_cycle() creates it if the table was empty, so a
 * PIC never sees "waiting for the manager to start a cycle".
 */
export async function fetchOpenCycle(): Promise<OrderCycle> {
  const { data, error } = await supabase
    .from("order_cycles")
    .select("*")
    .eq("status", "OPEN")
    .maybeSingle();
  if (!error && data) return data;

  // Empty table, or the OPEN cycle was deleted: create it. The RPC is
  // SECURITY DEFINER so a PIC can bootstrap it without a manager present.
  const { data: created, error: rpcError } = await supabase.rpc(
    "ensure_open_cycle",
  );
  return must<OrderCycle>(created, rpcError ?? error);
}

/**
 * The order the manager/driver is currently working through — the cycle that
 * has left OPEN but is not finished. Runs alongside the OPEN cycle, which is
 * already collecting the next round of requests.
 *
 * Falls back to the most recent COMPLETED cycle so the pricing and delivery
 * history screens still have something to show once everything is delivered.
 */
export async function fetchWorkingCycle(): Promise<OrderCycle | null> {
  const { data, error } = await supabase
    .from("order_cycles")
    .select("*")
    .in("status", ["ORDERED", "PURCHASED", "IN_DELIVERY"])
    .maybeSingle();
  if (error) return maybe(data, error);
  if (data) return data;

  const { data: last, error: lastError } = await supabase
    .from("order_cycles")
    .select("*")
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return maybe(last, lastError);
}

/** Transitions are validated by the order_cycle_guard trigger server-side. */
export async function setCycleStatus(
  cycleId: string,
  status: CycleStatus,
): Promise<OrderCycle> {
  const { data, error } = await supabase
    .from("order_cycles")
    .update({ status })
    .eq("id", cycleId)
    .select()
    .single();
  return must(data, error);
}
