import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import {
  addRequestItem,
  createStoreRequest,
  deleteRequestItem,
  fetchStoreRequest,
  updateRequestItem,
} from "../../lib/api/requests";
import { ApiError } from "../../lib/api/helpers";
import { ItemPickerModal } from "./ItemPickerModal";
import { ConfirmDialog } from "../../components/Modal";
import {
  Badge,
  Button,
  EmptyState,
  PageTitle,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { fmtQty } from "../../lib/format";
import { t } from "../../i18n/strings";
import type { Item, RequestItemWithItem } from "../../lib/types";

const requestKey = (cycleId: string, storeId: string) =>
  ["request", "mine", cycleId, storeId] as const;

export default function PicRequestPage() {
  const { session, profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: cycle, isLoading: cycleLoading } = useCurrentCycle();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RequestItemWithItem | null>(
    null,
  );

  const storeId = profile?.store_id ?? "";
  const cycleId = cycle?.id ?? "";
  const editable = cycle?.status === "OPEN";

  const { data: request, isLoading } = useQuery({
    queryKey: requestKey(cycleId, storeId),
    queryFn: () => fetchStoreRequest(cycleId, storeId),
    enabled: Boolean(cycleId && storeId && cycle?.status !== "COMPLETED"),
  });

  useRealtimeInvalidate(
    "pic-request",
    ["request_items", "store_requests"],
    [requestKey(cycleId, storeId), cycleKeys.current],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: requestKey(cycleId, storeId) });

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const addMutation = useMutation({
    mutationFn: async ({
      item,
      qty,
      unit,
    }: {
      item: Item;
      qty: number;
      unit: string;
    }) => {
      let requestId = request?.id;
      if (!requestId) {
        const created = await createStoreRequest(
          cycleId,
          storeId,
          session!.user.id,
        );
        requestId = created.id;
      }
      return addRequestItem({
        store_request_id: requestId,
        item_id: item.id,
        requested_qty: qty,
        unit,
      });
    },
    onSuccess: () => {
      toast.success(t.itemAdded);
      setPickerOpen(false);
      void invalidate();
    },
    onError: onApiError,
  });

  const qtyMutation = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) =>
      updateRequestItem(id, { requested_qty: qty }),
    onSuccess: () => void invalidate(),
    onError: onApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteRequestItem(id),
    onSuccess: () => {
      setRemoveTarget(null);
      void invalidate();
    },
    onError: onApiError,
  });

  if (cycleLoading) return <SkeletonList />;

  if (!cycle || cycle.status === "COMPLETED") {
    return (
      <>
        <PageTitle>{t.myRequest}</PageTitle>
        <EmptyState emoji="⏳" message={t.waitingForCycle} />
      </>
    );
  }

  const lines = request?.request_items ?? [];

  return (
    <>
      <PageTitle
        right={
          editable ? (
            <Badge color="green">{t.cycleStatus.OPEN}</Badge>
          ) : (
            <Badge color="amber">{t.cycleStatus[cycle.status]}</Badge>
          )
        }
      >
        {t.myRequest}
      </PageTitle>

      {!editable && (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.requestLocked}
        </p>
      )}

      {isLoading ? (
        <SkeletonList />
      ) : lines.length === 0 ? (
        <EmptyState message={t.requestEmpty} />
      ) : (
        <ul className="space-y-2">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5"
            >
              <span className="text-2xl">{line.item.emoji ?? "🥬"}</span>
              <div className="flex-1">
                <div className="font-semibold">{line.item.name}</div>
                <div className="text-xs text-gray-400">{line.unit}</div>
              </div>
              {editable ? (
                <>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    step="0.1"
                    className="min-h-12 w-20 rounded-xl border border-gray-300 px-2 text-center font-semibold"
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
                    aria-label={t.remove}
                    className="flex h-12 w-10 items-center justify-center rounded-xl text-red-400 active:bg-red-50"
                    onClick={() => setRemoveTarget(line)}
                  >
                    🗑
                  </button>
                </>
              ) : (
                <span className="font-bold">
                  {fmtQty(line.requested_qty, line.unit)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <Button
          className="mt-4 w-full"
          onClick={() => setPickerOpen(true)}
          busy={addMutation.isPending && !pickerOpen}
        >
          ➕ {t.addItem}
        </Button>
      )}

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeItemIds={lines.map((l) => l.item_id)}
        busy={addMutation.isPending}
        onPick={(item, qty, unit) => addMutation.mutate({ item, qty, unit })}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={t.remove}
        message={t.removeItemConfirm}
        danger
        busy={removeMutation.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget.id)}
      />
    </>
  );
}
