import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOpenCycle, useWorkingCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import {
  addRequestItem,
  aggregateRequests,
  deleteRequestItem,
  deleteStoreRequest,
  fetchAllRequests,
  groupByCategory,
  managerRequestForStore,
  updateRequestItem,
} from "../../lib/api/requests";
import { fetchCategories } from "../../lib/api/categories";
import { ItemPickerModal } from "../requests/ItemPickerModal";
import { ConfirmDialog } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageTitle,
  Select,
  SkeletonList,
} from "../../components/ui";
import type { Item } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { fmtDate, fmtQty } from "../../lib/format";
import { t } from "../../i18n/strings";

export const allRequestsKey = (cycleId: string) =>
  ["requests", "all", cycleId] as const;

/**
 * Filter value for "not in any category". Needed as its own option: without
 * it there is no way to pull up the items nobody has filed yet, which is
 * exactly the list the manager needs in order to go and file them.
 */
const UNFILED = "__unfiled__";

export default function ManagerDashboard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  // Branches file into the OPEN cycle, which always exists. The working cycle
  // is the order already sent to the market, if one is still out.
  const { data: cycle, isLoading: cycleLoading } = useOpenCycle();
  const { data: working } = useWorkingCycle();
  const [tab, setTab] = useState<"stores" | "aggregated">("stores");
  /** "" = every category. Narrows both tabs to one category at a time (0019). */
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  /** store_id whose request the manager is adding an item to, if any. */
  const [addTarget, setAddTarget] = useState<string | null>(null);
  /** Pending deletion, awaiting confirmation. */
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "line"; id: string; label: string }
    | { kind: "request"; id: string; label: string }
    | null
  >(null);

  const cycleId = cycle?.id ?? "";
  const orderInFlight = Boolean(working && working.status !== "COMPLETED");

  const { data: requests, isLoading } = useQuery({
    queryKey: allRequestsKey(cycleId),
    queryFn: () => fetchAllRequests(cycleId),
    enabled: Boolean(cycleId),
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
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

  const deleteMutation = useMutation({
    mutationFn: (target: NonNullable<typeof deleteTarget>) =>
      target.kind === "line"
        ? deleteRequestItem(target.id)
        : deleteStoreRequest(target.id),
    onSuccess: () => {
      toast.success(t.updated);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: allRequestsKey(cycleId) });
    },
    onError: (e) => {
      setDeleteTarget(null);
      onApiError(e);
    },
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

  // Narrow to one category by dropping lines that are not in it, then drop
  // any order left with nothing — an empty card would just be noise.
  const visibleRequests = useMemo(() => {
    if (!categoryFilter) return requests ?? [];
    const activeIds = new Set((categories ?? []).map((c) => c.id));
    const matches = (categoryId: string | null) =>
      categoryFilter === UNFILED
        ? // A deactivated category reads as unfiled here, matching how the
          // aggregated tab groups it.
          !categoryId || !activeIds.has(categoryId)
        : categoryId === categoryFilter;

    return (requests ?? [])
      .map((req) => ({
        ...req,
        request_items: req.request_items.filter((line) =>
          matches(line.item.category_id),
        ),
      }))
      .filter((req) => req.request_items.length > 0);
  }, [requests, categoryFilter, categories]);

  const aggregated = aggregateRequests(visibleRequests);

  // The aggregated tab reads category by category, which is the order the
  // manager buys in: one category, one vendor.
  const aggregatedGroups = groupByCategory(
    aggregated,
    categories ?? [],
    (line) => line.category_id,
  );

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

      {(categories ?? []).length > 0 && (
        <Select
          className="mb-3"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">{t.allCategories}</option>
          {(categories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.emoji ? `${category.emoji} ` : ""}
              {category.name}
            </option>
          ))}
          <option value={UNFILED}>{t.uncategorized}</option>
        </Select>
      )}

      {isLoading ? (
        <SkeletonList />
      ) : visibleRequests.length === 0 ? (
        // Distinguish "nobody has ordered" from "nothing in THIS category" —
        // the same empty screen for both reads as if the branches sent nothing.
        <EmptyState
          emoji="📭"
          message={
            (requests ?? []).length > 0 && categoryFilter
              ? t.noItemsInCategory
              : t.noRequestsYet
          }
        />
      ) : tab === "stores" ? (
        <div className="space-y-3">
          {visibleRequests.map((req) => (
            <Card key={req.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex-1 font-bold">
                  {req.store.name}
                  {/* A branch may send follow-up orders (0019). Anything after
                      the first is labelled so the manager can see at a glance
                      that it arrived late rather than being part of the
                      original list. */}
                  {req.seq > 1 && (
                    <span className="ms-2 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {t.additionalOrder} · {t.orderNumber} {req.seq}
                    </span>
                  )}
                </span>
                <Badge color="green">{req.request_items.length}</Badge>
                <button
                  aria-label={`${t.remove} ${req.store.name}`}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-red-400 active:bg-red-50"
                  onClick={() =>
                    setDeleteTarget({
                      kind: "request",
                      id: req.id,
                      label: req.store.name,
                    })
                  }
                >
                  🗑
                </button>
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
                    <button
                      aria-label={`${t.remove} ${line.item.name}`}
                      className="flex h-10 w-8 items-center justify-center rounded-lg text-red-400 active:bg-red-50"
                      onClick={() =>
                        setDeleteTarget({
                          kind: "line",
                          id: line.id,
                          label: line.item.name,
                        })
                      }
                    >
                      🗑
                    </button>
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
        <div className="space-y-4">
          {aggregatedGroups.map((group) => (
            <section key={group.category?.id ?? "unfiled"}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-600">
                <span>
                  {group.category?.emoji ? `${group.category.emoji} ` : "🗂️ "}
                  {group.category?.name ?? t.uncategorized}
                </span>
                <span className="text-xs font-normal text-gray-400">
                  {group.lines.length}
                </span>
              </h2>
              <div className="space-y-2">
                {group.lines.map((agg) => (
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
            </section>
          ))}
        </div>
      )}

      {orderInFlight && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.orderInFlight}
        </p>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t.remove}
        message={
          deleteTarget?.kind === "request"
            ? `${t.deleteRequestConfirm} (${deleteTarget.label})`
            : `${t.removeItemConfirm} (${deleteTarget?.label ?? ""})`
        }
        danger
        busy={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
      />

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
