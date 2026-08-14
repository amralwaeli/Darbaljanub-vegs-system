import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentCycle, useSetCycleStatus, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import { fetchAllRequests, updateRequestItem } from "../../lib/api/requests";
import { allRequestsKey } from "./ManagerDashboard";
import { ConfirmDialog } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageTitle,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { fmtMoney, fmtQty } from "../../lib/format";
import { t } from "../../i18n/strings";
import type { RequestItemWithItem } from "../../lib/types";

/** One aggregated cost row: same item + unit across every store. */
interface CostGroup {
  key: string;
  name: string;
  emoji: string | null;
  unit: string;
  totalQty: number;
  unitCost: number | null;
  lines: (RequestItemWithItem & { storeName: string })[];
}

export default function CostEntryPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: cycle, isLoading: cycleLoading } = useCurrentCycle();
  const setStatus = useSetCycleStatus();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const cycleId = cycle?.id ?? "";
  const ready = cycle && ["ORDERED", "PURCHASED"].includes(cycle.status);

  const { data: requests, isLoading } = useQuery({
    queryKey: allRequestsKey(cycleId),
    queryFn: () => fetchAllRequests(cycleId),
    enabled: Boolean(cycleId && ready),
  });

  useRealtimeInvalidate(
    "cost-entry",
    ["request_items"],
    [allRequestsKey(cycleId), cycleKeys.current],
  );

  const groups = useMemo<CostGroup[]>(() => {
    const map = new Map<string, CostGroup>();
    for (const req of requests ?? []) {
      for (const line of req.request_items) {
        const key = `${line.item_id}|${line.unit}`;
        let group = map.get(key);
        if (!group) {
          group = {
            key,
            name: line.item.name,
            emoji: line.item.emoji,
            unit: line.unit,
            totalQty: 0,
            unitCost: line.unit_cost,
            lines: [],
          };
          map.set(key, group);
        }
        group.totalQty += Number(line.purchased_qty ?? line.requested_qty);
        group.lines.push({ ...line, storeName: req.store.name });
        if (line.unit_cost !== null) group.unitCost = line.unit_cost;
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [requests]);

  const allCosted =
    groups.length > 0 && groups.every((g) => g.unitCost !== null);

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: allRequestsKey(cycleId) });

  // Setting a unit cost applies to EVERY store's line of that item+unit —
  // the DB computes each store's share (line_total) itself.
  const costMutation = useMutation({
    mutationFn: async ({ group, cost }: { group: CostGroup; cost: number }) => {
      for (const line of group.lines) {
        await updateRequestItem(line.id, { unit_cost: cost });
      }
    },
    onSuccess: () => {
      toast.success(t.costsSaved);
      void invalidate();
    },
    onError: onApiError,
  });

  const qtyMutation = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) =>
      updateRequestItem(id, { purchased_qty: qty }),
    onSuccess: () => void invalidate(),
    onError: onApiError,
  });

  if (cycleLoading) return <SkeletonList />;

  if (!ready) {
    return (
      <>
        <PageTitle>{t.costEntryTitle}</PageTitle>
        <EmptyState emoji="🧾" message={t.noActiveCycle} />
      </>
    );
  }

  return (
    <>
      <PageTitle
        right={allCosted ? <Badge color="green">{t.allCostsIn}</Badge> : undefined}
      >
        {t.costEntryTitle}
      </PageTitle>

      {isLoading ? (
        <SkeletonList />
      ) : groups.length === 0 ? (
        <EmptyState emoji="📭" message={t.noRequestsYet} />
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <Card key={group.key}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{group.emoji ?? "🥬"}</span>
                <div className="flex-1">
                  <div className="font-semibold">{group.name}</div>
                  <div className="text-xs text-gray-400">
                    {fmtQty(group.totalQty, group.unit)} ·{" "}
                    {group.lines.length} {t.stores.toLowerCase()}
                  </div>
                </div>
                <label className="block w-28">
                  <span className="text-xs text-gray-400">{t.unitCost}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.05"
                    defaultValue={group.unitCost ?? ""}
                    className="min-h-11 w-full rounded-lg border border-gray-300 px-2 text-end font-semibold"
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (
                        e.target.value !== "" &&
                        Number.isFinite(value) &&
                        value >= 0 &&
                        value !== Number(group.unitCost ?? NaN)
                      ) {
                        costMutation.mutate({ group, cost: value });
                      }
                    }}
                  />
                </label>
              </div>

              <button
                className="mt-2 text-xs font-medium text-brand-700"
                onClick={() =>
                  setExpanded(expanded === group.key ? null : group.key)
                }
              >
                {expanded === group.key ? "▲" : "▼"} {t.purchasedQty}
              </button>

              {expanded === group.key && (
                <ul className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                  {group.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex-1 text-gray-600">
                        {line.storeName}
                        <span className="ms-2 text-xs text-gray-400">
                          ({fmtQty(line.requested_qty, line.unit)})
                        </span>
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        defaultValue={line.purchased_qty ?? line.requested_qty}
                        className="min-h-10 w-24 rounded-lg border border-gray-300 px-2 text-end"
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (
                            Number.isFinite(value) &&
                            value >= 0 &&
                            value !==
                              Number(line.purchased_qty ?? line.requested_qty)
                          ) {
                            qtyMutation.mutate({ id: line.id, qty: value });
                          }
                        }}
                      />
                      <span className="w-20 text-end text-xs text-gray-500">
                        {fmtMoney(line.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {cycle.status === "ORDERED" && (
        <Button
          className="mt-4 w-full"
          disabled={!allCosted}
          onClick={() => setConfirmFinish(true)}
        >
          ✅ {t.markPurchased}
        </Button>
      )}

      <ConfirmDialog
        open={confirmFinish}
        title={t.markPurchased}
        message={t.markPurchasedConfirm}
        busy={setStatus.isPending}
        onCancel={() => setConfirmFinish(false)}
        onConfirm={() =>
          setStatus.mutate(
            { id: cycle.id, status: "PURCHASED" },
            { onSuccess: () => setConfirmFinish(false), onError: onApiError },
          )
        }
      />
    </>
  );
}
