import { useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchChecklist,
  fetchDelivery,
  getPhotoUrl,
  markLoaded,
  setCheck,
  uploadDeliveryPhoto,
} from "../../lib/api/deliveries";
import { ApiError } from "../../lib/api/helpers";
import { ConfirmDialog } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  PageTitle,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { fmtQty, fmtTime } from "../../lib/format";
import { t } from "../../i18n/strings";

const deliveryKey = (id: string) => ["delivery", id] as const;
const checklistKey = (id: string) => ["checklist", id] as const;

export default function DeliveryDetailPage() {
  const { deliveryId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);

  const { data: delivery, isLoading } = useQuery({
    queryKey: deliveryKey(deliveryId),
    queryFn: () => fetchDelivery(deliveryId),
    enabled: Boolean(deliveryId),
  });

  // Checklist rows come from the price-free driver view.
  const { data: checklist, isLoading: checksLoading } = useQuery({
    queryKey: checklistKey(deliveryId),
    queryFn: () => fetchChecklist(deliveryId),
    enabled: Boolean(deliveryId),
  });

  const pending = delivery?.status === "PENDING";
  const allChecked =
    (checklist ?? []).length > 0 && (checklist ?? []).every((c) => c.checked);
  const effectivePhotoPath = photoPath ?? delivery?.photo_path ?? null;
  const canLoad = pending && allChecked && Boolean(effectivePhotoPath);

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  // Optimistic tick: instant UI, offline-queued if the network is down.
  const checkMutation = useMutation({
    mutationFn: ({ checkId, checked }: { checkId: string; checked: boolean }) =>
      setCheck(checkId, checked),
    onMutate: async ({ checkId, checked }) => {
      await queryClient.cancelQueries({ queryKey: checklistKey(deliveryId) });
      const previous = queryClient.getQueryData(checklistKey(deliveryId));
      queryClient.setQueryData(
        checklistKey(deliveryId),
        (old: typeof checklist) =>
          (old ?? []).map((c) =>
            c.check_id === checkId ? { ...c, checked } : c,
          ),
      );
      return { previous };
    },
    onError: (e, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(checklistKey(deliveryId), context.previous);
      }
      onApiError(e);
    },
  });

  async function onPhotoChosen(file: File | undefined) {
    if (!file || !delivery) return;
    setUploading(true);
    setPhotoPreview(URL.createObjectURL(file));
    try {
      const path = await uploadDeliveryPhoto(delivery.id, file);
      setPhotoPath(path);
    } catch (e) {
      setPhotoPreview(null);
      onApiError(e);
    } finally {
      setUploading(false);
    }
  }

  const loadMutation = useMutation({
    mutationFn: () => markLoaded(deliveryId, effectivePhotoPath!),
    onSuccess: () => {
      setConfirmLoad(false);
      toast.success(t.loaded);
      void queryClient.invalidateQueries({ queryKey: deliveryKey(deliveryId) });
      void queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      navigate("/", { replace: true });
    },
    onError: (e) => {
      setConfirmLoad(false);
      onApiError(e);
    },
  });

  async function showExistingPhoto() {
    if (!delivery?.photo_path) return;
    try {
      setPhotoPreview(await getPhotoUrl(delivery.photo_path));
    } catch (e) {
      onApiError(e);
    }
  }

  if (isLoading || checksLoading) return <SkeletonList />;
  if (!delivery) return null;

  return (
    <>
      {/* Explicit back button — installed iOS PWAs have no system back */}
      <button
        onClick={() => navigate(-1)}
        className="mb-2 flex min-h-10 items-center gap-1 rounded-xl pe-3 font-semibold text-brand-700 active:bg-brand-50"
      >
        {t.back}
      </button>
      <PageTitle
        right={
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
        }
      >
        🏪 {delivery.store.name}
      </PageTitle>
      {delivery.store.address && (
        <p className="-mt-2 mb-4 text-sm text-gray-500">
          📍 {delivery.store.address}
        </p>
      )}

      <Card>
        <h2 className="mb-2 font-bold text-gray-700">{t.itemsToLoad}</h2>
        <ul className="divide-y divide-gray-50">
          {(checklist ?? []).map((row) => (
            <li key={row.check_id}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  className="h-6 w-6 rounded-md accent-brand-600"
                  checked={row.checked}
                  disabled={!pending}
                  onChange={(e) =>
                    checkMutation.mutate({
                      checkId: row.check_id,
                      checked: e.target.checked,
                    })
                  }
                />
                <span
                  className={`flex-1 font-medium ${
                    row.checked ? "text-gray-400 line-through" : ""
                  }`}
                >
                  {row.item_name}
                </span>
                <span className="font-bold">{fmtQty(row.qty)}</span>
              </label>
            </li>
          ))}
        </ul>
        {allChecked && (
          <p className="mt-1 text-sm font-medium text-brand-700">
            ✓ {t.allChecked}
          </p>
        )}
      </Card>

      <Card className="mt-3">
        <h2 className="mb-2 font-bold text-gray-700">{t.photoProof}</h2>
        {photoPreview ? (
          <img
            src={photoPreview}
            alt="Loading proof"
            className="mb-3 w-full rounded-xl"
          />
        ) : delivery.photo_path && !pending ? (
          <Button
            variant="secondary"
            className="mb-3 w-full"
            onClick={() => void showExistingPhoto()}
          >
            📷 {t.viewPhoto}
          </Button>
        ) : null}

        {pending && (
          <>
            {/* capture="environment" opens the rear camera directly on phones */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPhotoChosen(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              className="w-full"
              busy={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              📷 {photoPreview ? t.retakePhoto : t.takePhoto}
            </Button>
          </>
        )}
        {uploading && (
          <p className="mt-2 text-sm text-gray-500">{t.photoUploading}</p>
        )}
      </Card>

      {pending && (
        <>
          <Button
            className="mt-4 w-full text-lg"
            disabled={!canLoad}
            onClick={() => setConfirmLoad(true)}
          >
            🚚 {t.markLoaded}
          </Button>
          {!canLoad && (
            <p className="mt-2 text-center text-xs text-gray-400">
              {t.checkAllFirst}
            </p>
          )}
        </>
      )}

      {delivery.loaded_at && (
        <p className="mt-3 text-center text-sm text-gray-500">
          {t.loadedAt}: {fmtTime(delivery.loaded_at)}
        </p>
      )}
      {delivery.received_at && (
        <p className="mt-1 text-center text-sm text-gray-500">
          {t.receivedAt}: {fmtTime(delivery.received_at)}
        </p>
      )}

      <ConfirmDialog
        open={confirmLoad}
        title={t.markLoaded}
        message={t.markLoadedConfirm}
        busy={loadMutation.isPending}
        onCancel={() => setConfirmLoad(false)}
        onConfirm={() => loadMutation.mutate()}
      />
    </>
  );
}
