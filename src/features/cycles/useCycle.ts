import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCycle,
  fetchCurrentCycle,
  setCycleStatus,
} from "../../lib/api/cycles";
import type { CycleStatus } from "../../lib/database.types";

export const cycleKeys = {
  current: ["cycle", "current"] as const,
};

export function useCurrentCycle() {
  return useQuery({
    queryKey: cycleKeys.current,
    queryFn: fetchCurrentCycle,
  });
}

export function useCreateCycle(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("no user");
      return createCycle(userId);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: cycleKeys.current }),
  });
}

export function useSetCycleStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CycleStatus }) =>
      setCycleStatus(id, status),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: cycleKeys.current }),
  });
}
