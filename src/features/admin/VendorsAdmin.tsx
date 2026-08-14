import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVendor,
  fetchVendors,
  updateVendor,
} from "../../lib/api/vendors";
import { Modal } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { t } from "../../i18n/strings";
import type { Vendor } from "../../lib/types";

export function VendorsAdmin() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [notes, setNotes] = useState("");

  const { data: vendors, isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
  });

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        whatsapp_number: number.replace(/\D/g, ""),
        notes: notes.trim() || null,
      };
      if (editing === "new") return createVendor(input);
      return updateVendor(editing!.id, input);
    },
    onSuccess: () => {
      toast.success(t.saved);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
    onError: onApiError,
  });

  const toggleMutation = useMutation({
    mutationFn: (vendor: Vendor) =>
      updateVendor(vendor.id, { is_active: !vendor.is_active }),
    onSuccess: () => {
      toast.success(t.updated);
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
    onError: onApiError,
  });

  function openEditor(vendor: Vendor | "new") {
    setEditing(vendor);
    setName(vendor === "new" ? "" : vendor.name);
    setNumber(vendor === "new" ? "" : vendor.whatsapp_number);
    setNotes(vendor === "new" ? "" : (vendor.notes ?? ""));
  }

  if (isLoading) return <SkeletonList />;

  return (
    <>
      {(vendors ?? []).length === 0 ? (
        <EmptyState emoji="🛒" message={t.nothingHere} />
      ) : (
        <div className="space-y-2">
          {(vendors ?? []).map((vendor) => (
            <Card key={vendor.id} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-semibold">
                  {vendor.name}{" "}
                  {!vendor.is_active && <Badge color="red">{t.inactive}</Badge>}
                </div>
                <div className="text-xs text-gray-400">
                  📱 {vendor.whatsapp_number}
                  {vendor.notes ? ` · ${vendor.notes}` : ""}
                </div>
              </div>
              <Button variant="ghost" onClick={() => openEditor(vendor)}>
                {t.edit}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Button className="mt-4 w-full" onClick={() => openEditor("new")}>
        ➕ {t.addVendor}
      </Button>

      <Modal
        open={editing !== null}
        title={editing === "new" ? t.addVendor : t.edit}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <Input
            label={t.vendorName}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label={t.whatsappNumber}
            inputMode="numeric"
            maxLength={17}
            placeholder="9665xxxxxxxx"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <Input
            label={t.notes}
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {editing !== "new" && editing !== null && (
            <Button
              variant="secondary"
              className="w-full"
              busy={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(editing)}
            >
              {editing.is_active ? t.deactivate : t.reactivate}
            </Button>
          )}
          <Button
            className="w-full"
            busy={saveMutation.isPending}
            disabled={!name.trim() || number.replace(/\D/g, "").length < 6}
            onClick={() => saveMutation.mutate()}
          >
            {t.save}
          </Button>
        </div>
      </Modal>
    </>
  );
}
