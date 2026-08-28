import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrderingCycle, cycleKeys } from "../cycles/useCycle";
import { fetchAllRequests } from "../../lib/api/requests";
import { fetchCategories } from "../../lib/api/categories";
import {
  fetchVendorOrders,
  fetchVendors,
  recordVendorOrder,
} from "../../lib/api/vendors";
import { buildVendorMessage, waLink } from "../../lib/whatsapp";
import { openExternal, needsNativeLinkHandling } from "../../lib/native/links";
import { allRequestsKey } from "./ManagerDashboard";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageTitle,
  Select,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { fmtQty, fmtTime } from "../../lib/format";
import { t } from "../../i18n/strings";

const vendorOrdersKey = (cycleId: string) =>
  ["vendorOrders", cycleId] as const;

export default function VendorOrdersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: cycle, isLoading: cycleLoading } = useOrderingCycle();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vendorId, setVendorId] = useState("");
  // Orders are placed one branch at a time (0013): the vendor delivers to each
  // shop, so mixing two shops into one message would be undeliverable.
  const [storeId, setStoreId] = useState("");
  /**
   * "" = every category. Picking one narrows BOTH the lines below and the
   * vendor list, because that is the whole point of filing vendors under a
   * category (0019): one category, one vendor, one message.
   */
  const [categoryFilter, setCategoryFilter] = useState("");

  const cycleId = cycle?.id ?? "";
  // OPEN is included: sending the first order is what locks the cycle, so the
  // manager must be able to send while it is still open.
  const ready =
    cycle && ["OPEN", "ORDERED", "PURCHASED"].includes(cycle.status);

  const { data: requests, isLoading } = useQuery({
    queryKey: allRequestsKey(cycleId),
    queryFn: () => fetchAllRequests(cycleId),
    enabled: Boolean(cycleId && ready),
  });
  const { data: vendors } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
    enabled: Boolean(ready),
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    enabled: Boolean(ready),
  });
  const { data: sentOrders } = useQuery({
    queryKey: vendorOrdersKey(cycleId),
    queryFn: () => fetchVendorOrders(cycleId),
    enabled: Boolean(cycleId && ready),
  });

  // Vendors for the chosen category, or all of them when no category is
  // chosen. A vendor with no category set stays visible either way, so an
  // unfiled vendor can never become unreachable.
  const activeVendors = (vendors ?? [])
    .filter((v) => v.is_active)
    .filter(
      (v) =>
        !categoryFilter ||
        v.category_id === categoryFilter ||
        v.category_id === null,
    );
  const vendor = activeVendors.find((v) => v.id === vendorId) ?? null;

  // One entry per branch: a branch may have sent several orders this cycle
  // (0019), and they are all being bought at once.
  const branches = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const req of requests ?? []) map.set(req.store_id, req.store);
    return [...map.values()];
  }, [requests]);

  const storeRequests = (requests ?? []).filter((r) => r.store_id === storeId);
  const storeName = storeRequests[0]?.store.name ?? "";

  /**
   * Every line one branch asked for in one category, across all of its orders.
   *
   * A function rather than just the rendered list because the branch and
   * category pickers need it for the selection they are ABOUT to switch to,
   * which the current render has not computed yet.
   */
  const linesOf = (store: string, category: string) =>
    (requests ?? [])
      .filter((r) => r.store_id === store)
      .flatMap((r) => r.request_items)
      .filter(
        (line) => !category || (line.item.category_id ?? "") === category,
      );

  const lines = linesOf(storeId, categoryFilter);
  const allSelected =
    lines.length > 0 && lines.every((line) => selected.has(line.id));

  // Default to the first branch, and drop a selection that no longer exists.
  useEffect(() => {
    if (branches.length === 0) return;
    if (!branches.some((b) => b.id === storeId)) setStoreId(branches[0].id);
  }, [branches, storeId]);

  const chosenLines = lines.filter((l) => selected.has(l.id));
  const message =
    storeName && chosenLines.length > 0
      ? buildVendorMessage(
          storeName,
          chosenLines.map((l) => ({
            name: l.item.name,
            qty: Number(l.requested_qty),
            unit: l.unit,
          })),
          cycle?.cycle_date ?? "",
        )
      : "";

  const sendMutation = useMutation({
    mutationFn: () =>
      recordVendorOrder(
        cycleId,
        vendor!.id,
        storeId,
        message,
        chosenLines.map((l) => ({
          item_id: l.item_id,
          name: l.item.name,
          qty: Number(l.requested_qty),
          unit: l.unit,
        })),
      ),
    onSuccess: () => {
      toast.success(`${t.orderSentTo} ${vendor!.name}`);
      // Open WhatsApp AFTER the snapshot is safely recorded.
      void openExternal(waLink(vendor!.whatsapp_number, message));
      setSelected(new Set());
      setVendorId("");
      void queryClient.invalidateQueries({ queryKey: vendorOrdersKey(cycleId) });
      // The first vendor order moves this cycle OPEN -> ORDERED server-side
      // (0012) and opens the next one, so re-read both.
      void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : t.errorGeneric),
  });

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (cycleLoading) return <SkeletonList />;

  if (!ready) {
    return (
      <>
        <PageTitle>{t.vendorOrdersTitle}</PageTitle>
        <EmptyState emoji="🛒" message={t.noOrderYet} />
      </>
    );
  }

  return (
    <>
      <PageTitle>{t.vendorOrdersTitle}</PageTitle>

      {isLoading ? (
        <SkeletonList />
      ) : branches.length === 0 ? (
        <EmptyState emoji="📭" message={t.noRequestsYet} />
      ) : (
        <>
          <Select
            label={t.selectBranch}
            className="mb-3"
            value={storeId}
            onChange={(e) => {
              const nextStore = e.target.value;
              setStoreId(nextStore);
              // A tick on one branch means nothing on another — but if the
              // manager is buying a whole category, they are buying it for
              // this branch too, so carry the "all of it" intent over.
              setSelected(
                categoryFilter
                  ? new Set(linesOf(nextStore, categoryFilter).map((l) => l.id))
                  : new Set(),
              );
            }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>

          {/* Narrowing to one category is what makes this screen quick: the
              lines below and the vendor list below them both shrink to the
              one category being bought (0019). */}
          {(categories ?? []).length > 0 && (
            <Select
              label={t.filterByCategory}
              className="mb-3"
              value={categoryFilter}
              onChange={(e) => {
                const nextCategory = e.target.value;
                setCategoryFilter(nextCategory);
                // Choosing a category IS choosing its items: one category,
                // one vendor, one message (0019). The manager buys الورقيات
                // as a basket, so tick the whole basket rather than making
                // them tap twenty rows to say what the dropdown already said.
                setSelected(
                  nextCategory
                    ? new Set(
                        linesOf(storeId, nextCategory).map((l) => l.id),
                      )
                    : new Set(),
                );
                // The chosen vendor belonged to the old category.
                setVendorId("");
              }}
            >
              <option value="">{t.allCategories}</option>
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji ? `${category.emoji} ` : ""}
                  {category.name}
                </option>
              ))}
            </Select>
          )}

          {lines.length > 0 && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-500">
                {selected.size}/{lines.length} {t.itemsSelected}
              </span>
              <button
                onClick={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(lines.map((l) => l.id)),
                  )
                }
                className="min-h-9 rounded-xl px-3 text-sm font-semibold text-brand-700 active:bg-brand-50"
              >
                {allSelected ? t.clearSelection : t.selectAll}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {lines.map((line) => {
              const checked = selected.has(line.id);
              return (
                <button
                  key={line.id}
                  onClick={() => toggle(line.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 bg-white p-3 text-start transition-colors ${
                    checked ? "border-brand-600 bg-brand-50" : "border-transparent shadow-sm ring-1 ring-black/5"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm font-bold ${
                      checked
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-gray-300 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span className="flex-1 font-semibold">{line.item.name}</span>
                  <span className="font-bold text-brand-700">
                    {fmtQty(line.requested_qty)}
                  </span>
                </button>
              );
            })}
          </div>

          <Card className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-gray-600">
                {selected.size} {t.itemsSelected}
              </span>
            </div>
            <Select
              label={t.selectVendor}
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">—</option>
              {activeVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
            {vendor && chosenLines.length > 0 && (
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
                {message}
              </pre>
            )}
            <Button
              className="w-full"
              disabled={!vendor || chosenLines.length === 0}
              busy={sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
            >
              💬 {t.openWhatsApp}
            </Button>
          </Card>
        </>
      )}

      {(sentOrders ?? []).length > 0 && (
        <div className="mt-6 space-y-2">
          <h2 className="font-bold text-gray-700">{t.vendorOrdersTitle}</h2>
          {(sentOrders ?? []).map((order) => (
            <Card key={order.id}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{order.vendor.name}</span>
                <Badge color="green">{fmtTime(order.sent_at)}</Badge>
              </div>
              {order.store && (
                <div className="mt-0.5 text-xs text-gray-500">
                  {order.store.name}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <a
                  className="flex min-h-10 flex-1 items-center justify-center rounded-xl border border-brand-600 text-sm font-semibold text-brand-700 active:bg-brand-50"
                  href={waLink(order.vendor.whatsapp_number, order.message_snapshot)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    // In the APK, hand the link to Android so it opens the
                    // WhatsApp app itself; the WebView cannot be relied on to
                    // do that with target="_blank". The web keeps the plain
                    // anchor, so middle-click and ctrl-click still work.
                    if (needsNativeLinkHandling) {
                      e.preventDefault();
                      void openExternal(
                        waLink(
                          order.vendor.whatsapp_number,
                          order.message_snapshot,
                        ),
                      );
                    }
                  }}
                >
                  💬 {t.openWhatsApp}
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
