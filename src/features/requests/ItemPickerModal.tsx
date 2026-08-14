import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../components/Modal";
import { Button, Input, Select, Spinner } from "../../components/ui";
import { fetchCatalog, proposeItem } from "../../lib/api/items";
import { useToast } from "../../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { ApiError } from "../../lib/api/helpers";
import { t } from "../../i18n/strings";
import { UNITS, type Item } from "../../lib/types";

export function ItemPickerModal({
  open,
  onClose,
  excludeItemIds,
  onPick,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  excludeItemIds: string[];
  onPick: (item: Item, qty: number, unit: string) => void;
  busy: boolean;
}) {
  const toast = useToast();
  const { session } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<string>("kg");
  const [proposeMode, setProposeMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState<string>("kg");
  const [proposing, setProposing] = useState(false);

  const { data: catalog, isLoading } = useQuery({
    queryKey: ["items", "catalog"],
    queryFn: fetchCatalog,
    enabled: open,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog ?? [])
      .filter((i) => !excludeItemIds.includes(i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [catalog, excludeItemIds, search]);

  function selectItem(item: Item) {
    setSelected(item);
    setUnit(item.default_unit);
    setQty("");
  }

  function confirmAdd() {
    const n = Number(qty);
    if (!selected || !Number.isFinite(n) || n <= 0) return;
    onPick(selected, n, unit);
    setSelected(null);
    setSearch("");
  }

  async function submitProposal() {
    const name = newName.trim();
    if (!name || !session) return;
    setProposing(true);
    try {
      await proposeItem(name, newUnit, session.user.id);
      toast.success(t.newItemPending);
      setProposeMode(false);
      setNewName("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t.errorGeneric);
    } finally {
      setProposing(false);
    }
  }

  return (
    <Modal open={open} title={t.addItem} onClose={onClose}>
      {selected ? (
        <div className="space-y-4">
          <div className="text-lg font-semibold">{selected.name}</div>
          {/*
            No unit picker: each item carries its own unit, set once when the
            item is created. That is what lets every list show just a name and
            a number — two rows of the same item can never mean different
            things, so there is nothing for the PIC to get wrong.
          */}
          <Input
            label={t.qty}
            type="number"
            inputMode="decimal"
            min="0.1"
            step="0.1"
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setSelected(null)}
            >
              {t.cancel}
            </Button>
            <Button
              className="flex-1"
              busy={busy}
              disabled={!qty || Number(qty) <= 0}
              onClick={confirmAdd}
            >
              {t.addItem}
            </Button>
          </div>
        </div>
      ) : proposeMode ? (
        <div className="space-y-4">
          <Input
            label={t.newItemName}
            maxLength={60}
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Select
            label={t.newItemUnit}
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t.units[u]}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setProposeMode(false)}
            >
              {t.cancel}
            </Button>
            <Button
              className="flex-1"
              busy={proposing}
              disabled={!newName.trim()}
              onClick={() => void submitProposal()}
            >
              {t.requestNewItem}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            placeholder={t.searchItems}
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    className="flex min-h-12 w-full items-center gap-3 px-1 py-2 text-start active:bg-brand-50"
                    onClick={() => selectItem(item)}
                  >
                    <span className="flex-1 font-medium">{item.name}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="py-6 text-center text-sm text-gray-400">
                  {t.nothingHere}
                </li>
              )}
            </ul>
          )}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setProposeMode(true)}
          >
            ➕ {t.requestNewItem}
          </Button>
        </div>
      )}
    </Modal>
  );
}
