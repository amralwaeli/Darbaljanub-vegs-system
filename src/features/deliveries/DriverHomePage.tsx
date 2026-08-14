import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkingCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import { fetchDeliveries } from "../../lib/api/deliveries";
import {
  Badge,
  EmptyState,
  PageTitle,
  SkeletonList,
} from "../../components/ui";
import { fmtTime } from "../../lib/format";
import { t } from "../../i18n/strings";
import type { DeliveryStatus } from "../../lib/database.types";

export const deliveriesKey = (cycleId: string) =>
  ["deliveries", cycleId] as const;

const STATUS_BADGE: Record<
  DeliveryStatus,
  { color: "gray" | "blue" | "green"; label: string }
> = {
  PENDING: { color: "gray", label: t.pending },
  LOADED: { color: "blue", label: t.loaded },
  RECEIVED: { color: "green", label: t.received },
};

export default function DriverHomePage() {
  const { data: cycle, isLoading: cycleLoading } = useWorkingCycle();
  const cycleId = cycle?.id ?? "";
  const active =
    cycle && ["PURCHASED", "IN_DELIVERY"].includes(cycle.status);

  const { data: deliveries, isLoading } = useQuery({
    queryKey: deliveriesKey(cycleId),
    queryFn: () => fetchDeliveries(cycleId),
    enabled: Boolean(cycleId && active),
  });

  useRealtimeInvalidate(
    "driver-deliveries",
    ["deliveries"],
    [deliveriesKey(cycleId), cycleKeys.all],
  );

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
        {(deliveries ?? []).map((delivery) => {
          const badge = STATUS_BADGE[delivery.status];
          return (
            <Link
              key={delivery.id}
              to={`/delivery/${delivery.id}`}
              className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 active:bg-brand-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">
                  🏪 {delivery.store.name}
                </span>
                <Badge color={badge.color}>{badge.label}</Badge>
              </div>
              {delivery.store.address && (
                <p className="mt-1 text-sm text-gray-500">
                  📍 {delivery.store.address}
                </p>
              )}
              {delivery.loaded_at && (
                <p className="mt-1 text-xs text-gray-400">
                  {t.loadedAt}: {fmtTime(delivery.loaded_at)}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </>
  );
}
