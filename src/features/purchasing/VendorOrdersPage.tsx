import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrderingCycle, cycleKeys } from "../cycles/useCycle";
import { fetchAllRequests } from "../../lib/api/requests";
import {
  fetchVendorOrders,
  fetchVendors,
  recordVendorOrder,
} from "../../lib/api/vendors";
import { buildVendorMessage, waLink } from "../../lib/whatsapp";
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
  const { data: sentOrders } = useQuery({
    queryKey: vendorOrdersKey(cycleId),
    queryFn: () => fetchVendorOrders(cycleId),
    enabled: Boolean(cycleId && ready),
  });

  const activeVendors = (vendors ?? []).filter((v) => v.is_active);
  const vendor = activeVendors.find((v) => v.id === vendorId) ?? null;

  const branches = (requests ?? []).map((r) => r.store);
  const request = (requests ?? []).find((r) => r.store_id === storeId) ?? null;
  const lines = request?.request_items ?? [];

  // Default to the first branch, and drop a selection that no longer exists.
  useEffect(() => {
    if (branches.length === 0) return;
    if (!branches.some((b) => b.id === storeId)) setStoreId(branches[0].id);
  }, [branches, storeId]);

  const chosenLines = lines.filter((l) => selected.has(l.id));
  const message =
    request && chosenLines.length > 0
      ? buildVendorMessage(
          request.store.name,
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
      window.open(waLink(vendor!.whatsapp_number, message), "_blank");
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
              setStoreId(e.target.value);
              setSelected(new Set()); // a tick on one branch means nothing on another
            }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>

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
