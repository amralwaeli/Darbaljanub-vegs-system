import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOpenCycle, useWorkingCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import {
  addRequestItem,
  aggregateRequests,
  fetchAllRequests,
  managerRequestForStore,
  updateRequestItem,
} from "../../lib/api/requests";
import { ItemPickerModal } from "../requests/ItemPickerModal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageTitle,
  SkeletonList,
} from "../../components/ui";
import type { Item } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { fmtDate, fmtQty } from "../../lib/format";
import { t } from "../../i18n/strings";

export const allRequestsKey = (cycleId: string) =>
  ["requests", "all", cycleId] as const;

export default function ManagerDashboard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  // Branches file into the OPEN cycle, which always exists. The working cycle
  // is the order already sent to the market, if one is still out.
  const { data: cycle, isLoading: cycleLoading } = useOpenCycle();
  const { data: working } = useWorkingCycle();
  const [tab, setTab] = useState<"stores" | "aggregated">("stores");
  /** store_id whose request the manager is adding an item to, if any. */
  const [addTarget, setAddTarget] = useState<string | null>(null);

  const cycleId = cycle?.id ?? "";
  const orderInFlight = Boolean(working && working.status !== "COMPLETED");

  const { data: requests, isLoading } = useQuery({
    queryKey: allRequestsKey(cycleId),
    queryFn: () => fetchAllRequests(cycleId),
    enabled: Boolean(cycleId),
  });

  // New PIC submissions appear live.
  useRealtimeInvalidate(
    "manager-requests",
    ["store_requests", "request_items"],
    [allRequestsKey(cycleId), cycleKeys.all],
  );

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const qtyMutation = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) =>
      updateRequestItem(id, { requested_qty: qty }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: allRequestsKey(cycleId) }),
    onError: onApiError,
  });

  const addMutation = useMutation({
    mutationFn: async ({
      storeId,
      item,
      qty,
    }: {
      storeId: string;
      item: Item;
      qty: number;
    }) => {
      // Returns the existing request, or creates one if the store never sent.
      const req = await managerRequestForStore(cycleId, storeId);
      return addRequestItem({
        store_request_id: req.id,
        item_id: item.id,
        requested_qty: qty,
        unit: item.default_unit,
      });
    },
    onSuccess: () => {
      toast.success(t.itemAdded);
      setAddTarget(null);
      void queryClient.invalidateQueries({ queryKey: allRequestsKey(cycleId) });
    },
    onError: onApiError,
  });

  if (cycleLoading) return <SkeletonList />;

  if (!cycle) {
    return (
      <>
        <PageTitle>{t.requestsTitle}</PageTitle>
        <EmptyState emoji="🌅" message={t.noActiveCycle} />
      </>
    );
  }

  const aggregated = aggregateRequests(requests ?? []);

  return (
    <>
      <PageTitle
        right={<span className="text-sm text-gray-500">{fmtDate(cycle.cycle_date)}</span>}
      >
        {t.requestsTitle}
      </PageTitle>

      <div className="mb-4 flex rounded-xl bg-gray-200/60 p-1">
        {(["stores", "aggregated"] as const).map((key) => (
          <button
            key={key}
            className={`min-h-10 flex-1 rounded-lg text-sm font-semibold transition-colors ${
              tab === key ? "bg-white text-brand-700 shadow-sm" : "text-gray-500"
            }`}
            onClick={() => setTab(key)}
          >
            {key === "stores" ? t.perStore : t.aggregated}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : (requests ?? []).length === 0 ? (
        <EmptyState emoji="📭" message={t.noRequestsYet} />
      ) : tab === "stores" ? (
        <div className="space-y-3">
          {(requests ?? []).map((req) => (
            <Card key={req.id}>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-bold">{req.store.name}</span>
                <Badge color="green">{req.request_items.length}</Badge>
              </div>
              <ul className="divide-y divide-gray-50 text-sm">
                {req.request_items.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="flex-1">{line.item.name}</span>
                    {/* The store can no longer touch a sent request, so the
                        manager owns the numbers from here on. */}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.1"
                      step="0.1"
                      aria-label={line.item.name}
                      className="min-h-10 w-20 rounded-lg border border-gray-300 px-2 text-center font-semibold"
                      defaultValue={line.requested_qty}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (
                          Number.isFinite(value) &&
                          value > 0 &&
                          value !== Number(line.requested_qty)
                        ) {
                          qtyMutation.mutate({ id: line.id, qty: value });
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
              {/* The manager can still add to a sent request — they are the one
                  on the phone with the market (0013). */}
              <Button
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => setAddTarget(req.store_id)}
              >
                ➕ {t.addItem}
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {aggregated.map((agg) => (
            <Card key={`${agg.item_id}|${agg.unit}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{agg.name}</span>
                <span className="text-lg font-bold text-brand-700">
                  {fmtQty(agg.total_qty)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {agg.perStore
                  .map((s) => `${s.store_name}: ${fmtQty(s.qty)}`)
                  .join(" · ")}
              </p>
            </Card>
          ))}
        </div>
      )}

      {orderInFlight && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.orderInFlight}
        </p>
      )}

      <ItemPickerModal
        open={addTarget !== null}
        onClose={() => setAddTarget(null)}
        excludeItemIds={
          (requests ?? [])
            .find((r) => r.store_id === addTarget)
            ?.request_items.map((l) => l.item_id) ?? []
        }
        busy={addMutation.isPending}
        onPick={(item, qty) =>
          addTarget && addMutation.mutate({ storeId: addTarget, item, qty })
        }
      />

      {/* No "lock the cycle" step: sending the order to a vendor on the
          WhatsApp tab is what closes this cycle (migration 0012). */}
      {(requests ?? []).length > 0 && !orderInFlight && (
        <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {t.readyToOrder}
        </p>
      )}
    </>
  );
}
