import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStore,
  fetchStores,
  fetchUsers,
  updateStore,
} from "../../lib/api/admin";
import { Modal } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { t } from "../../i18n/strings";
import type { Store } from "../../lib/types";

export function StoresAdmin() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Store | "new" | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [picId, setPicId] = useState("");

  const { data: stores, isLoading } = useQuery({
    queryKey: ["stores"],
    queryFn: fetchStores,
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const pics = (users ?? []).filter((u) => u.role === "pic" && u.is_active);

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing === "new") {
        return createStore({ name: name.trim(), address: address.trim() || null });
      }
      return updateStore(editing!.id, {
        name: name.trim(),
        address: address.trim() || null,
        pic_id: picId || null,
      });
    },
    onSuccess: () => {
      toast.success(t.saved);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: onApiError,
  });

  function openEditor(store: Store | "new") {
    setEditing(store);
    setName(store === "new" ? "" : store.name);
    setAddress(store === "new" ? "" : (store.address ?? ""));
    setPicId(store === "new" ? "" : (store.pic_id ?? ""));
  }

  if (isLoading) return <SkeletonList />;

  return (
    <>
      {(stores ?? []).length === 0 ? (
        <EmptyState emoji="🏪" message={t.nothingHere} />
      ) : (
        <div className="space-y-2">
          {(stores ?? []).map((store) => {
            const pic = (users ?? []).find((u) => u.id === store.pic_id);
            return (
              <Card key={store.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-semibold">
                    🏪 {store.name}{" "}
                    {!store.is_active && <Badge color="red">{t.inactive}</Badge>}
                  </div>
                  <div className="text-xs text-gray-400">
                    {store.address ?? "—"} · {t.assignedPic}:{" "}
                    {pic?.username ?? t.none}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => openEditor(store)}>
                  {t.edit}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <Button className="mt-4 w-full" onClick={() => openEditor("new")}>
        ➕ {t.addStore}
      </Button>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t.addStore : t.edit}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <Input
            label={t.storeName}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label={t.storeAddress}
            maxLength={300}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          {editing !== "new" && (
            <Select
              label={t.assignedPic}
              value={picId}
              onChange={(e) => setPicId(e.target.value)}
            >
              <option value="">{t.none}</option>
              {pics.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username ?? p.id.slice(0, 8)}
                </option>
              ))}
            </Select>
          )}
          <Button
            className="w-full"
            busy={saveMutation.isPending}
            disabled={!name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {t.save}
          </Button>
        </div>
      </Modal>
    </>
  );
}
