import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useOpenCycle, cycleKeys } from "../cycles/useCycle";
import { useRealtimeInvalidate } from "../../hooks/useRealtime";
import {
  addRequestItem,
  deleteRequestItem,
  draftOf,
  ensureStoreDraft,
  fetchStoreRequests,
  sentOf,
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

/**
 * The branch's order screen.
 *
 * Since 0019 a branch may send SEVERAL orders in one cycle: they press Send,
 * remember the coriander an hour later, and send a follow-up. So this screen
 * shows a list of orders rather than one:
 *   * every order already sent, read-only, numbered
 *   * at most one editable draft (the DB enforces "at most one" with a partial
 *     unique index)
 * Adding an item when no draft exists starts the next one.
 */
export default function PicRequestPage() {
  const { profile } = useAuth();
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

  const { data: requests, isLoading } = useQuery({
    queryKey: requestKey(cycleId, storeId),
    queryFn: () => fetchStoreRequests(cycleId, storeId),
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

  const draft = draftOf(requests ?? []);
  const sent = sentOf(requests ?? []);
  const lines = draft?.request_items ?? [];

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
      // No open draft means this item begins the next order — the first of
      // the day, or a follow-up after one has already been sent. Resolved
      // server-side so a stale cache cannot produce a duplicate draft.
      const target = draft ?? (await ensureStoreDraft(cycleId, storeId));
      return addRequestItem({
        store_request_id: target.id,
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

  return (
    <>
      <PageTitle
        right={
          draft ? (
            <Badge color="green">{t.requestDraftBadge}</Badge>
          ) : sent.length > 0 ? (
            <Badge color="blue">{t.requestSentBadge}</Badge>
          ) : null
        }
      >
        {t.myRequest}
      </PageTitle>

      {isLoading ? (
        <SkeletonList />
      ) : (
        <>
          {/* ------------------------------------------- already sent --- */}
          {sent.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                {t.previousOrders}
              </h2>
              <div className="space-y-3">
                {sent.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-2xl bg-blue-50/60 p-3 ring-1 ring-blue-100"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Badge color="blue">
                        {t.orderNumber} {order.seq}
                      </Badge>
                      {order.seq > 1 && (
                        <span className="text-xs text-gray-500">
                          {t.additionalOrder}
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1">
                      {order.request_items.map((line) => (
                        <li
                          key={line.id}
                          className="flex items-center gap-3 text-sm"
                        >
                          <span className="flex-1">{line.item.name}</span>
                          <span className="font-bold">
                            {fmtQty(line.requested_qty)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">{t.requestSentNote}</p>
            </section>
          )}

          {/* ----------------------------------------- the open draft --- */}
          {draft && lines.length > 0 && (
            <ul className="space-y-2">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5"
                >
                  <div className="flex-1 font-semibold">{line.item.name}</div>
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
                </li>
              ))}
            </ul>
          )}

{/* Keyed off the LINES, not off whether a draft row exists: a draft the
              branch emptied out has no lines to show and still needs to say
              something. */}
          {lines.length === 0 && sent.length === 0 && (
            <EmptyState message={t.requestEmpty} />
          )}

          {/* Nothing left to edit but something already sent — offer the
              follow-up. */}
          {lines.length === 0 && sent.length > 0 && (
            <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
              {t.startNewOrderHint}
            </p>
          )}

          <Button
            variant="secondary"
            className="mt-4 w-full"
            onClick={() => setPickerOpen(true)}
            busy={addMutation.isPending && !pickerOpen}
          >
            {draft || sent.length === 0
              ? `➕ ${t.addItem}`
              : `➕ ${t.startNewOrder}`}
          </Button>

          {draft && lines.length > 0 && (
            <Button className="mt-2 w-full" onClick={() => setSendOpen(true)}>
              {t.sendRequest}
            </Button>
          )}
        </>
      )}

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        // Only the CURRENT draft's items are excluded: re-ordering something
        // that went out on an earlier order is exactly what a follow-up is for.
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
        onConfirm={() => draft && sendMutation.mutate(draft.id)}
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
