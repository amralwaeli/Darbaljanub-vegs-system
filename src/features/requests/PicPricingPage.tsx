import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useWorkingCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import { fetchStoreRequest, updateRequestItem } from "../../lib/api/requests";
import {
  fetchDeliveries,
  getPhotoUrl,
  markReceived,
} from "../../lib/api/deliveries";
import { ApiError } from "../../lib/api/helpers";
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
import { fmtMoney, fmtQty, fmtTime } from "../../lib/format";
import { t } from "../../i18n/strings";

const priceKey = (cycleId: string, storeId: string) =>
  ["prices", cycleId, storeId] as const;
const deliveryKey = (cycleId: string) => ["deliveries", cycleId] as const;

export default function PicPricingPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: cycle, isLoading: cycleLoading } = useWorkingCycle();
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const storeId = profile?.store_id ?? "";
  const cycleId = cycle?.id ?? "";
  const costsReady =
    cycle && ["PURCHASED", "IN_DELIVERY", "COMPLETED"].includes(cycle.status);

  const { data: request, isLoading } = useQuery({
    queryKey: priceKey(cycleId, storeId),
    queryFn: () => fetchStoreRequest(cycleId, storeId),
    enabled: Boolean(cycleId && storeId && costsReady),
  });

  const { data: deliveries } = useQuery({
    queryKey: deliveryKey(cycleId),
    queryFn: () => fetchDeliveries(cycleId),
    enabled: Boolean(cycleId && costsReady),
  });
  const myDelivery = deliveries?.find((d) => d.store_id === storeId) ?? null;

  useRealtimeInvalidate(
    "pic-prices",
    ["request_items", "deliveries"],
    [priceKey(cycleId, storeId), deliveryKey(cycleId), cycleKeys.all],
  );

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const priceMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      updateRequestItem(id, { selling_price: price }),
    onSuccess: () => {
      toast.success(t.priceSaved);
      void queryClient.invalidateQueries({
        queryKey: priceKey(cycleId, storeId),
      });
    },
    onError: onApiError,
  });

  const receiveMutation = useMutation({
    mutationFn: () => markReceived(myDelivery!.id),
    onSuccess: () => {
      setConfirmReceive(false);
      toast.success(t.received);
      void queryClient.invalidateQueries({ queryKey: deliveryKey(cycleId) });
    },
    onError: onApiError,
  });

  async function showPhoto(path: string) {
    try {
      setPhotoUrl(await getPhotoUrl(path));
    } catch (e) {
      onApiError(e);
    }
  }

  if (cycleLoading) return <SkeletonList />;

  if (!cycle || !costsReady) {
    return (
      <>
        <PageTitle>{t.myPrices}</PageTitle>
        <EmptyState emoji="💰" message={t.pricesNotReady} />
      </>
    );
  }

  const lines = request?.request_items ?? [];
  const total = lines.reduce((sum, l) => sum + (l.line_total ?? 0), 0);

  return (
    <>
      <PageTitle>{t.myPrices}</PageTitle>

      {isLoading ? (
        <SkeletonList />
      ) : lines.length === 0 ? (
        <EmptyState message={t.nothingHere} />
      ) : (
        <>
          <ul className="space-y-2">
            {lines.map((line) => (
              <li
                key={line.id}
                className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-semibold">{line.item.name}</span>
                  <span className="text-sm text-gray-500">
                    {fmtQty(line.purchased_qty ?? line.requested_qty)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 items-end gap-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-400">{t.costPrice}</div>
                    <div className="font-semibold">
                      {fmtMoney(line.unit_cost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">{t.lineTotal}</div>
                    <div className="font-semibold">
                      {fmtMoney(line.line_total)}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-xs text-gray-400">
                      {t.sellingPrice}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.05"
                      defaultValue={line.selling_price ?? ""}
                      className="min-h-10 w-full rounded-lg border border-gray-300 px-2 text-end font-semibold"
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (
                          e.target.value !== "" &&
                          Number.isFinite(value) &&
                          value >= 0 &&
                          value !== Number(line.selling_price ?? NaN)
                        ) {
                          priceMutation.mutate({ id: line.id, price: value });
                        }
                      }}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <Card className="mt-3 flex items-center justify-between">
            <span className="font-semibold text-gray-600">{t.lineTotal}</span>
            <span className="text-lg font-bold">{fmtMoney(total)}</span>
          </Card>
        </>
      )}

      {myDelivery && (
        <Card className="mt-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{t.navDeliveries}</span>
            <Badge
              color={
                myDelivery.status === "RECEIVED"
                  ? "green"
                  : myDelivery.status === "PENDING"
                    ? "gray"
                    : "blue"
              }
            >
              {myDelivery.status === "PENDING"
                ? t.pending
                : myDelivery.status === "LOADED"
                  ? t.loaded
                  : myDelivery.status === "OFFLOADED"
                    ? t.offloadedShort
                    : t.received}
            </Badge>
          </div>
          {myDelivery.loaded_at && (
            <p className="mt-1 text-sm text-gray-500">
              {t.loadedAt}: {fmtTime(myDelivery.loaded_at)}
            </p>
          )}
          {myDelivery.offloaded_at && (
            <p className="mt-1 text-sm text-gray-500">
              {t.offloadedAt}: {fmtTime(myDelivery.offloaded_at)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {myDelivery.photo_path && (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void showPhoto(myDelivery.photo_path!)}
              >
                📷 {t.viewPhoto}
              </Button>
            )}
            {myDelivery.offload_photo_path && (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void showPhoto(myDelivery.offload_photo_path!)}
              >
                📷 {t.viewOffloadPhoto}
              </Button>
            )}
            {/* Receipt is confirmed after the driver has offloaded (0015). */}
            {myDelivery.status === "OFFLOADED" && (
              <Button
                className="flex-1"
                onClick={() => setConfirmReceive(true)}
              >
                {t.confirmReceived}
              </Button>
            )}
          </div>
          {photoUrl && (
            <img
              src={photoUrl}
              alt="Loading proof"
              className="mt-3 w-full rounded-xl"
            />
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirmReceive}
        title={t.confirmReceived}
        message={t.confirmReceivedQ}
        busy={receiveMutation.isPending}
        onCancel={() => setConfirmReceive(false)}
        onConfirm={() => receiveMutation.mutate()}
      />
    </>
  );
}
