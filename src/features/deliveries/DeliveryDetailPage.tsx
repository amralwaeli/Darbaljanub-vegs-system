import { useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChecklistRow,
  fetchChecklist,
  fetchDelivery,
  getPhotoUrl,
  markLoaded,
  markOffloaded,
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
import { capturePhoto, hasNativeCamera } from "../../lib/native/camera";

const deliveryKey = (id: string) => ["delivery", id] as const;
const checklistKey = (id: string) => ["checklist", id] as const;

export default function DeliveryDetailPage() {
  const { deliveryId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const offloadInputRef = useRef<HTMLInputElement>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);
  // Second proof, taken at the branch when the goods come off the truck.
  const [offloadPath, setOffloadPath] = useState<string | null>(null);
  const [offloadPreview, setOffloadPreview] = useState<string | null>(null);
  const [offloadUploading, setOffloadUploading] = useState(false);
  const [confirmOffload, setConfirmOffload] = useState(false);
  // How the driver reads the checklist. Grouped by default: the truck is
  // loaded one category of crates at a time, not in alphabetical order.
  const [groupedView, setGroupedView] = useState(true);

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

  /**
   * The checklist bucketed by category, in the manager's display order with
   * the unfiled bucket last.
   *
   * An item whose category was deleted has a category_id but no name after
   * the view's LEFT JOIN; it is folded into the unfiled bucket rather than
   * becoming a nameless group of its own.
   */
  const groups = useMemo(() => {
    const buckets = new Map<
      string,
      {
        label: string | null;
        emoji: string | null;
        sort: number;
        rows: ChecklistRow[];
      }
    >();

    for (const row of checklist ?? []) {
      const key = row.category_name ? (row.category_id ?? "") : "";
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          label: row.category_name,
          emoji: row.category_emoji,
          // Unfiled sorts last, never into the middle of the real categories.
          sort: row.category_sort ?? Number.MAX_SAFE_INTEGER,
          rows: [],
        };
        buckets.set(key, bucket);
      }
      bucket.rows.push(row);
    }

    return [...buckets.entries()]
      .map(([key, bucket]) => ({ key, ...bucket }))
      .sort(
        (a, b) =>
          a.sort - b.sort || (a.label ?? "").localeCompare(b.label ?? ""),
      );
  }, [checklist]);

  const pending = delivery?.status === "PENDING";
  const loaded = delivery?.status === "LOADED";
  const allChecked =
    (checklist ?? []).length > 0 && (checklist ?? []).every((c) => c.checked);
  const effectivePhotoPath = photoPath ?? delivery?.photo_path ?? null;
  const canLoad = pending && allChecked && Boolean(effectivePhotoPath);
  const effectiveOffloadPath =
    offloadPath ?? delivery?.offload_photo_path ?? null;
  const canOffload = loaded && Boolean(effectiveOffloadPath);

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

  /** Both photos go through the same path — only which slot they fill differs. */
  async function onPhotoChosen(
    file: Blob | undefined,
    kind: "load" | "offload",
    preOptimized = false,
  ) {
    if (!file || !delivery) return;
    const setBusy = kind === "load" ? setUploading : setOffloadUploading;
    const setPreview = kind === "load" ? setPhotoPreview : setOffloadPreview;
    const setPath = kind === "load" ? setPhotoPath : setOffloadPath;

    setBusy(true);
    setPreview(URL.createObjectURL(file));
    try {
      setPath(await uploadDeliveryPhoto(delivery.id, file, { preOptimized }));
    } catch (e) {
      setPreview(null);
      onApiError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Take the proof photo.
   *
   * In the APK this opens the real OS camera, which hands back a JPEG — the
   * whole HEIC failure that stopped drivers completing deliveries simply
   * cannot occur. On the web it falls back to the hidden file input.
   */
  async function startCapture(kind: "load" | "offload") {
    if (!hasNativeCamera) {
      const input = kind === "load" ? fileInputRef : offloadInputRef;
      input.current?.click();
      return;
    }
    try {
      const photo = await capturePhoto();
      // null = the driver backed out of the camera, which is not an error.
      if (photo) await onPhotoChosen(photo.blob, kind, true);
    } catch (e) {
      onApiError(e);
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

  const offloadMutation = useMutation({
    mutationFn: () => markOffloaded(deliveryId, effectiveOffloadPath!),
    onSuccess: () => {
      setConfirmOffload(false);
      toast.success(t.offloaded);
      void queryClient.invalidateQueries({ queryKey: deliveryKey(deliveryId) });
      void queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      navigate("/", { replace: true });
    },
    onError: (e) => {
      setConfirmOffload(false);
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

  /** One tickable line. Identical in both views — only the grouping differs. */
  const renderRow = (row: ChecklistRow) => (
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
  );

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

        {/* Only worth offering once there is more than one bucket to switch
            between — a single-category delivery reads the same either way. */}
        {groups.length > 1 && (
          <div className="mb-3 flex rounded-xl bg-gray-200/60 p-1">
            {([true, false] as const).map((mode) => (
              <button
                key={String(mode)}
                className={`min-h-10 flex-1 rounded-lg text-sm font-semibold transition-colors ${
                  groupedView === mode
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-gray-500"
                }`}
                onClick={() => setGroupedView(mode)}
              >
                {mode ? t.groupByCategory : t.showAllItems}
              </button>
            ))}
          </div>
        )}

        {groupedView && groups.length > 1 ? (
          <div className="space-y-3">
            {groups.map((group) => {
              const done = group.rows.filter((r) => r.checked).length;
              return (
                <section key={group.key}>
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-gray-600">
                    <span className="flex-1">
                      {group.emoji ? `${group.emoji} ` : "🗂️ "}
                      {group.label ?? t.uncategorized}
                    </span>
                    {/* Loading a truck is counting crates: show the count per
                        category so a half-done group is obvious at a glance. */}
                    <span
                      className={`text-xs font-semibold ${
                        done === group.rows.length
                          ? "text-brand-700"
                          : "text-gray-400"
                      }`}
                    >
                      {done}/{group.rows.length}
                    </span>
                  </h3>
                  <ul className="divide-y divide-gray-50">
                    {group.rows.map(renderRow)}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {(checklist ?? []).map(renderRow)}
          </ul>
        )}

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
              onChange={(e) => void onPhotoChosen(e.target.files?.[0], "load")}
            />
            <Button
              variant="secondary"
              className="w-full"
              busy={uploading}
              onClick={() => void startCapture("load")}
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

      {/* At the branch: second photo, then offload. The guard trigger rejects
          OFFLOADED without the photo, so this cannot be skipped. */}
      {loaded && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold text-gray-700">{t.offloadProof}</h2>
          {offloadPreview ? (
            <img
              src={offloadPreview}
              alt={t.offloadProof}
              className="mb-2 w-full rounded-xl"
            />
          ) : null}
          <input
            ref={offloadInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onPhotoChosen(e.target.files?.[0], "offload")}
          />
          <Button
            variant="secondary"
            className="w-full"
            busy={offloadUploading}
            onClick={() => void startCapture("offload")}
          >
            📷 {offloadPreview ? t.retakePhoto : t.takePhoto}
          </Button>
          {offloadUploading && (
            <p className="mt-2 text-sm text-gray-500">{t.photoUploading}</p>
          )}

          <Button
            className="mt-3 w-full text-lg"
            disabled={!canOffload}
            onClick={() => setConfirmOffload(true)}
          >
            📦 {t.markOffloaded}
          </Button>
          {!canOffload && (
            <p className="mt-2 text-center text-xs text-gray-400">
              {t.offloadPhotoFirst}
            </p>
          )}
        </Card>
      )}

      {delivery.loaded_at && (
        <p className="mt-3 text-center text-sm text-gray-500">
          {t.loadedAt}: {fmtTime(delivery.loaded_at)}
        </p>
      )}
      {delivery.offloaded_at && (
        <p className="mt-1 text-center text-sm text-gray-500">
          {t.offloadedAt}: {fmtTime(delivery.offloaded_at)}
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

      <ConfirmDialog
        open={confirmOffload}
        title={t.markOffloaded}
        message={t.markOffloadedConfirm}
        busy={offloadMutation.isPending}
        onCancel={() => setConfirmOffload(false)}
        onConfirm={() => offloadMutation.mutate()}
      />
    </>
  );
}
