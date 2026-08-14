import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createItem, fetchAllItems, updateItem } from "../../lib/api/items";
import { Modal } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { t } from "../../i18n/strings";
import { UNITS, type Item } from "../../lib/types";

export function ItemsAdmin() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("kg");
  const [emoji, setEmoji] = useState("");

  const { data: items, isLoading } = useQuery({
    queryKey: ["items", "all"],
    queryFn: fetchAllItems,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["items", "all"] });
    void queryClient.invalidateQueries({ queryKey: ["items", "catalog"] });
  };

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing === "new") {
        return createItem({
          name,
          default_unit: unit,
          emoji: emoji.trim() || null,
        });
      }
      return updateItem(editing!.id, {
        name: name.trim(),
        default_unit: unit,
        emoji: emoji.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t.saved);
      setEditing(null);
      invalidate();
    },
    onError: onApiError,
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateItem>[1] }) =>
      updateItem(id, patch),
    onSuccess: () => {
      toast.success(t.updated);
      invalidate();
    },
    onError: onApiError,
  });

  function openEditor(item: Item | "new") {
    setEditing(item);
    setName(item === "new" ? "" : item.name);
    setUnit(item === "new" ? "kg" : item.default_unit);
    setEmoji(item === "new" ? "" : (item.emoji ?? ""));
  }

  if (isLoading) return <SkeletonList />;

  return (
    <>
      <div className="space-y-2">
        {(items ?? []).map((item) => (
          <Card key={item.id} className="flex items-center gap-3">
            <span className="text-xl">{item.emoji ?? "🥬"}</span>
            <div className="flex-1">
              <div className="font-semibold">
                {item.name}{" "}
                {!item.is_approved && (
                  <Badge color="amber">{t.pendingApproval}</Badge>
                )}
                {!item.is_active && <Badge color="red">{t.inactive}</Badge>}
              </div>
              <div className="text-xs text-gray-400">{item.default_unit}</div>
            </div>
            {!item.is_approved && (
              <Button
                variant="secondary"
                busy={patchMutation.isPending}
                onClick={() =>
                  patchMutation.mutate({
                    id: item.id,
                    patch: { is_approved: true },
                  })
                }
              >
                {t.approve}
              </Button>
            )}
            <Button variant="ghost" onClick={() => openEditor(item)}>
              {t.edit}
            </Button>
          </Card>
        ))}
      </div>

      <Button className="mt-4 w-full" onClick={() => openEditor("new")}>
        ➕ {t.addCatalogItem}
      </Button>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t.addCatalogItem : t.edit}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <Input
            label={t.newItemName}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t.newItemUnit}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
            <Input
              label="Emoji"
              maxLength={8}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
            />
          </div>
          {editing !== "new" && editing !== null && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() =>
                patchMutation.mutate({
                  id: editing.id,
                  patch: { is_active: !editing.is_active },
                })
              }
            >
              {editing.is_active ? t.deactivate : t.reactivate}
            </Button>
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
