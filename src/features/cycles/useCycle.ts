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
