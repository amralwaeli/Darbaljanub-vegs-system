import { supabase } from "../supabase";
import { must, maybe } from "./helpers";
import type { OrderCycle } from "../types";
import type { CycleStatus } from "../database.types";

/** The single most recent cycle (active or just completed). */
export async function fetchCurrentCycle(): Promise<OrderCycle | null> {
  const { data, error } = await supabase
    .from("order_cycles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return maybe(data, error);
}

export async function createCycle(userId: string): Promise<OrderCycle> {
  const { data, error } = await supabase
    .from("order_cycles")
    .insert({ created_by: userId })
    .select()
    .single();
  return must(data, error);
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
