import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchOpenCycle,
  fetchWorkingCycle,
  setCycleStatus,
} from "../../lib/api/cycles";
import type { CycleStatus } from "../../lib/database.types";

export const cycleKeys = {
  open: ["cycle", "open"] as const,
  working: ["cycle", "working"] as const,
  /** Prefix covering both — a status change moves a cycle between them. */
  all: ["cycle"] as const,
};

/** The cycle branches file requests into. Always exists (see migration 0009). */
export function useOpenCycle() {
  return useQuery({
    queryKey: cycleKeys.open,
    queryFn: fetchOpenCycle,
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
 * ORDERED and 0009 immediately opens a fresh OPEN cycle behind it — so from
 * then on we must follow the in-flight one, or the manager would lose the
 * order they are still sending to their other vendors.
 */
export function useOrderingCycle() {
  const working = useWorkingCycle();
  const open = useOpenCycle();
  const inFlight = working.data && working.data.status !== "COMPLETED";
  return {
    data: inFlight ? working.data : open.data,
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
