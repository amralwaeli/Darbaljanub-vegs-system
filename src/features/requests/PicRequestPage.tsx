import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useOpenCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import {
  addRequestItem,
  createStoreRequest,
  deleteRequestItem,
  fetchStoreRequest,
  submitStoreRequest,
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
  const { data: cycle, isLoading: cycleLoading } = useOpenCycle();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RequestItemWithItem | null>(
    null,
  );

  const storeId = profile?.store_id ?? "";
  const cycleId = cycle?.id ?? "";

  const { data: request, isLoading } = useQuery({
    queryKey: requestKey(cycleId, storeId),
    queryFn: () => fetchStoreRequest(cycleId, storeId),
    enabled: Boolean(cycleId && storeId),
  });

  useRealtimeInvalidate(
    "pic-request",
    ["request_items", "store_requests"],
    [requestKey(cycleId, storeId), cycleKeys.all],
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

  const sendMutation = useMutation({
    mutationFn: (id: string) => submitStoreRequest(id),
    onSuccess: () => {
      setSendOpen(false);
      toast.success(t.requestSent);
      void invalidate();
    },
    onError: onApiError,
  });

  if (cycleLoading) return <SkeletonList />;

  // An OPEN cycle always exists (migration 0009) — only a failed fetch lands
  // here, and the next launch retries.
  if (!cycle) {
    return (
      <>
        <PageTitle>{t.myRequest}</PageTitle>
        <EmptyState emoji="⏳" message={t.waitingForCycle} />
      </>
    );
  }

  const lines = request?.request_items ?? [];
  // The list is the PIC's to edit until they send it; after that only the
  // manager can change the numbers.
  const sent = request?.status === "SUBMITTED";

  return (
    <>
      <PageTitle
        right={
          sent ? (
            <Badge color="blue">{t.requestSentBadge}</Badge>
          ) : (
            <Badge color="green">{t.requestDraftBadge}</Badge>
          )
        }
      >
        {t.myRequest}
      </PageTitle>

      {sent && (
        <p className="mb-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {t.requestSentNote}
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
              <div className="flex-1 font-semibold">{line.item.name}</div>
              {sent ? (
                <span className="font-bold">{fmtQty(line.requested_qty)}</span>
              ) : (
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
              )}
            </li>
          ))}
        </ul>
      )}

      {!sent && (
        <>
          <Button
            variant="secondary"
            className="mt-4 w-full"
            onClick={() => setPickerOpen(true)}
            busy={addMutation.isPending && !pickerOpen}
          >
            ➕ {t.addItem}
          </Button>

          {lines.length > 0 && (
            <Button className="mt-2 w-full" onClick={() => setSendOpen(true)}>
              {t.sendRequest}
            </Button>
          )}
        </>
      )}

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeItemIds={lines.map((l) => l.item_id)}
        busy={addMutation.isPending}
        onPick={(item, qty, unit) => addMutation.mutate({ item, qty, unit })}
      />

      <ConfirmDialog
        open={sendOpen}
        title={t.sendRequest}
        message={t.sendRequestConfirm}
        busy={sendMutation.isPending}
        onCancel={() => setSendOpen(false)}
        onConfirm={() => request && sendMutation.mutate(request.id)}
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
