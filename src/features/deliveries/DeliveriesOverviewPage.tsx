import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useCurrentCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import { fetchDeliveries, getPhotoUrl } from "../../lib/api/deliveries";
import { deliveriesKey } from "./DriverHomePage";
import { Modal } from "../../components/Modal";
import {
  Badge,
  Card,
  EmptyState,
  PageTitle,
  SkeletonList,
  Spinner,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { fmtTime } from "../../lib/format";
import { t } from "../../i18n/strings";

/** Manager/superadmin: live view of every store's loading status + photos. */
export default function DeliveriesOverviewPage() {
  const toast = useToast();
  const { data: cycle, isLoading: cycleLoading } = useCurrentCycle();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const cycleId = cycle?.id ?? "";
  const active =
    cycle && ["PURCHASED", "IN_DELIVERY", "COMPLETED"].includes(cycle.status);

  const { data: deliveries, isLoading } = useQuery({
    queryKey: deliveriesKey(cycleId),
    queryFn: () => fetchDeliveries(cycleId),
    enabled: Boolean(cycleId && active),
  });

  useRealtimeInvalidate(
    "manager-deliveries",
    ["deliveries", "delivery_item_checks"],
    [deliveriesKey(cycleId), cycleKeys.current],
  );

  async function openPhoto(path: string) {
    setPhotoLoading(true);
    try {
      setPhotoUrl(await getPhotoUrl(path));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t.errorGeneric);
    } finally {
      setPhotoLoading(false);
    }
  }

  if (cycleLoading || (active && isLoading)) return <SkeletonList />;

  if (!active || (deliveries ?? []).length === 0) {
    return (
      <>
        <PageTitle>{t.deliveriesTitle}</PageTitle>
        <EmptyState emoji="🚚" message={t.noDeliveries} />
      </>
    );
  }

  return (
    <>
      <PageTitle>{t.deliveriesTitle}</PageTitle>
      <div className="space-y-3">
        {(deliveries ?? []).map((delivery) => (
          <Card key={delivery.id}>
            <div className="flex items-center justify-between">
              <Link
                to={`/delivery/${delivery.id}`}
                className="font-bold text-brand-800"
              >
                🏪 {delivery.store.name}
              </Link>
              <Badge
                color={
                  delivery.status === "RECEIVED"
                    ? "green"
                    : delivery.status === "LOADED"
                      ? "blue"
                      : "gray"
                }
              >
                {delivery.status === "PENDING"
                  ? t.pending
                  : delivery.status === "LOADED"
                    ? t.loaded
                    : t.received}
              </Badge>
            </div>
            <div className="mt-1 space-y-0.5 text-sm text-gray-500">
              {delivery.loaded_at && (
                <p>
                  {t.loadedAt}: {fmtTime(delivery.loaded_at)}
                </p>
              )}
              {delivery.received_at && (
                <p>
                  {t.receivedAt}: {fmtTime(delivery.received_at)}
                </p>
              )}
            </div>
            {delivery.photo_path && (
              <button
                className="mt-2 flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-brand-700 active:bg-brand-50"
                onClick={() => void openPhoto(delivery.photo_path!)}
              >
                📷 {t.viewPhoto}
                {photoLoading && <Spinner className="h-4 w-4" />}
              </button>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={photoUrl !== null}
        title={t.viewPhoto}
        onClose={() => setPhotoUrl(null)}
      >
        {photoUrl && (
          <img src={photoUrl} alt="Loading proof" className="w-full rounded-xl" />
        )}
      </Modal>
    </>
  );
}
