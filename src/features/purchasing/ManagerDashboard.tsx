import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useOpenCycle,
  useWorkingCycle,
  useSetCycleStatus,
  cycleKeys,
} from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import { aggregateRequests, fetchAllRequests } from "../../lib/api/requests";
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
import { fmtDate, fmtQty } from "../../lib/format";
import { t } from "../../i18n/strings";

export const allRequestsKey = (cycleId: string) =>
  ["requests", "all", cycleId] as const;

export default function ManagerDashboard() {
  const toast = useToast();
  // Branches file into the OPEN cycle, which always exists. The working cycle
  // is the order already sent to the market, if one is still out.
  const { data: cycle, isLoading: cycleLoading } = useOpenCycle();
  const { data: working } = useWorkingCycle();
  const setStatus = useSetCycleStatus();
  const [tab, setTab] = useState<"stores" | "aggregated">("stores");
  const [confirm, setConfirm] = useState<"lock" | null>(null);

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
                    <span>
                      {line.item.emoji ?? "🥬"} {line.item.name}
                    </span>
                    <span className="font-semibold">
                      {fmtQty(line.requested_qty, line.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {aggregated.map((agg) => (
            <Card key={`${agg.item_id}|${agg.unit}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {agg.emoji ?? "🥬"} {agg.name}
                </span>
                <span className="text-lg font-bold text-brand-700">
                  {fmtQty(agg.total_qty, agg.unit)}
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

      {(requests ?? []).length > 0 && !orderInFlight && (
        <Button className="mt-4 w-full" onClick={() => setConfirm("lock")}>
          🔒 {t.lockCycle}
        </Button>
      )}

      <ConfirmDialog
        open={confirm === "lock"}
        title={t.lockCycle}
        message={t.lockCycleConfirm}
        busy={setStatus.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          setStatus.mutate(
            { id: cycle.id, status: "ORDERED" },
            { onSuccess: () => setConfirm(null), onError: onApiError },
          )
        }
      />
    </>
  );
}
