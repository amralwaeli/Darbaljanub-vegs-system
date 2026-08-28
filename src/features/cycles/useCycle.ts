import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchOpenCycle,
  fetchWorkingCycle,
  setCycleStatus,
} from "../../lib/api/cycles";
import type { CycleStatus } from "../../lib/database.types";
import type { OrderCycle } from "../../lib/types";

// ---------------------------------------------------------------------------
// Remembering the OPEN cycle across launches.
//
// Almost every screen is TWO sequential round trips deep: fetch the cycle,
// then fetch that cycle's requests/deliveries. Against a database ~1s away
// (see queryClient.ts) that is two seconds of skeleton before anything can
// possibly appear, every single launch, for an id that changes once a day.
//
// So the last known cycle seeds the query. The dependent fetch fires
// immediately and in PARALLEL with the revalidation instead of behind it.
// It is a render hint, never an authority: it is revalidated on the spot, and
// if the id turns out to be different the dependent query is keyed by that id
// and refetches itself.
// ---------------------------------------------------------------------------
const OPEN_CYCLE_CACHE = "vegs.openCycle";
/** Beyond this the cached cycle is likely yesterday's — wait for the truth. */
const CACHE_MAX_AGE_MS = 6 * 3600_000;

function readCachedOpenCycle(): { cycle: OrderCycle; at: number } | null {
  try {
    const raw = localStorage.getItem(OPEN_CYCLE_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cycle: OrderCycle; at: number };
    if (!parsed?.cycle?.id || parsed.cycle.status !== "OPEN") return null;
    if (Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedOpenCycle(cycle: OrderCycle): void {
  try {
    localStorage.setItem(
      OPEN_CYCLE_CACHE,
      JSON.stringify({ cycle, at: Date.now() }),
    );
  } catch {
    /* private mode / quota — the network path still works */
  }
}

export const cycleKeys = {
  open: ["cycle", "open"] as const,
  working: ["cycle", "working"] as const,
  /** Prefix covering both — a status change moves a cycle between them. */
  all: ["cycle"] as const,
};

/** The cycle branches file requests into. Always exists (see migration 0009). */
export function useOpenCycle() {
  const cached = readCachedOpenCycle();
  return useQuery({
    queryKey: cycleKeys.open,
    queryFn: async () => {
      const cycle = await fetchOpenCycle();
      writeCachedOpenCycle(cycle);
      return cycle;
    },
    // initialDataUpdatedAt is the real timestamp, so the cache counts as
    // already stale and react-query revalidates on mount rather than trusting
    // it for the next staleTime window.
    ...(cached
      ? { initialData: cached.cycle, initialDataUpdatedAt: cached.at }
      : {}),
  });
}

/** The order being purchased/delivered right now, if any. */
export function useWorkingCycle() {
  return useQuery({
    queryKey: cycleKeys.working,
    queryFn: fetchWorkingCycle,
  });
}

/**
 * The cycle the manager is placing vendor orders against.
 *
 * Before the first vendor order that is the OPEN cycle (whose SUBMITTED
 * requests are what gets ordered). Sending the first order flips it to
 * ORDERED and 0009 immediately opens a fresh OPEN cycle behind it — so while
 * the manager is still working through their vendor list we follow the
 * in-flight one, or they would lose the order they are half-way through
 * sending.
 *
 * That preference ENDS at ORDERED. Once the cycle reaches PURCHASED or
 * IN_DELIVERY the manager has finished sending it to the market and the only
 * thing left is the truck — which must never hold up the next day's buying.
 * Following it past that point is what made a delivery in progress freeze the
 * whole screen on yesterday's list while today's requests piled up unseen in
 * the OPEN cycle behind it.
 */
export function useOrderingCycle() {
  const working = useWorkingCycle();
  const open = useOpenCycle();
  const stillSendingToVendors = working.data?.status === "ORDERED";
  return {
    data: stillSendingToVendors ? working.data : open.data,
    isLoading: working.isLoading || open.isLoading,
  };
}

export function useSetCycleStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CycleStatus }) =>
      setCycleStatus(id, status),
    // A status change moves the cycle between the open/working queries, so
    // refresh both, not just the one this screen happened to read.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: cycleKeys.all }),
  });
}
