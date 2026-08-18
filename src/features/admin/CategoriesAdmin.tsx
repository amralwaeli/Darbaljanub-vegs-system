import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  fetchAllCategories,
  setCategoryItems,
  updateCategory,
} from "../../lib/api/categories";
import { fetchAllItems } from "../../lib/api/items";
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
import type { Category } from "../../lib/types";

/**
 * Categories (0019): البطاطس والبصل, الورقيات, الخضار, ...
 *
 * Two jobs on one screen, because they are the same mental task:
 *   1. create / rename / reorder a category
 *   2. tick which catalogue items belong to it
 *
 * Items are filed FROM the category (rather than one by one from the items
 * screen) because that is how the manager thinks about it — "these are the
 * leafy greens" — though the items screen offers the per-item dropdown too.
 */
export function CategoriesAdmin() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  // The "choose items" sheet, keyed by the category being filled.
  const [picking, setPicking] = useState<Category | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: fetchAllCategories,
  });

  const { data: items } = useQuery({
    queryKey: ["items", "all"],
    queryFn: fetchAllItems,
  });

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  /** How many catalogue items currently sit in each category. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items ?? []) {
      if (item.category_id) {
        map.set(item.category_id, (map.get(item.category_id) ?? 0) + 1);
      }
    }
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? [])
      .filter((i) => i.is_active && i.is_approved)
      .filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [items, search]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    void queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        emoji: emoji.trim() || null,
        sort_order: Number(sortOrder) || 0,
      };
      if (editing === "new") return createCategory(input);
      return updateCategory((editing as Category).id, input);
    },
    onSuccess: () => {
      toast.success(t.saved);
      setEditing(null);
      invalidate();
    },
    onError: onApiError,
  });

  const toggleMutation = useMutation({
    mutationFn: (category: Category) =>
      updateCategory(category.id, { is_active: !category.is_active }),
    onSuccess: () => {
      toast.success(t.updated);
      setEditing(null);
      invalidate();
    },
    onError: onApiError,
  });

  const itemsMutation = useMutation({
    mutationFn: () => setCategoryItems(picking!.id, [...checked]),
    onSuccess: () => {
      toast.success(t.categoryItemsSaved);
      setPicking(null);
      invalidate();
    },
    onError: onApiError,
  });

  function openEditor(category: Category | "new") {
    setEditing(category);
    setName(category === "new" ? "" : category.name);
    setEmoji(category === "new" ? "" : (category.emoji ?? ""));
    setSortOrder(category === "new" ? "0" : String(category.sort_order));
  }

  function openPicker(category: Category) {
    setPicking(category);
    setSearch("");
    setChecked(
      new Set(
        (items ?? [])
          .filter((i) => i.category_id === category.id)
          .map((i) => i.id),
      ),
    );
  }

  function toggleItem(id: string) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (isLoading) return <SkeletonList />;

  return (
    <>
      {(categories ?? []).length === 0 ? (
        <EmptyState emoji="🗂️" message={t.categoryEmpty} />
      ) : (
        <div className="space-y-2">
          {(categories ?? []).map((category) => (
            <Card key={category.id} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-semibold">
                  {category.emoji ? `${category.emoji} ` : ""}
                  {category.name}{" "}
                  {!category.is_active && (
                    <Badge color="red">{t.inactive}</Badge>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {counts.get(category.id) ?? 0} · {t.items}
                </div>
              </div>
              <Button variant="ghost" onClick={() => openPicker(category)}>
                {t.chooseCategoryItems}
              </Button>
              <Button variant="ghost" onClick={() => openEditor(category)}>
                {t.edit}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Button className="mt-4 w-full" onClick={() => openEditor("new")}>
        ➕ {t.addCategory}
      </Button>

      {/* ------------------------------------------------ create / edit --- */}
      <Modal
        open={editing !== null}
        title={editing === "new" ? t.addCategory : t.edit}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <Input
            label={t.categoryName}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label={t.categoryEmoji}
            maxLength={8}
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
          />
          <Input
            label={t.categorySortOrder}
            inputMode="numeric"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
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
            disabled={!name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {t.save}
          </Button>
        </div>
      </Modal>

      {/* --------------------------------------------- choose its items --- */}
      <Modal
        open={picking !== null}
        title={`${t.categoryItemsTitle}${picking ? ` — ${picking.name}` : ""}`}
        onClose={() => setPicking(null)}
      >
        <div className="space-y-3">
          <Input
            placeholder={t.searchItems}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filteredItems.map((item) => {
              // Filed elsewhere: ticking it here moves it, so say so rather
              // than letting the manager wonder why it vanished from there.
              const elsewhere =
                item.category_id &&
                picking &&
                item.category_id !== picking.id &&
                !checked.has(item.id);
              return (
                <label
                  key={item.id}
                  className="flex min-h-11 items-center gap-3 rounded-xl px-2 active:bg-gray-100"
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-brand-600"
                    checked={checked.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                  <span className="flex-1 text-sm">
                    {item.emoji ? `${item.emoji} ` : ""}
                    {item.name}
                  </span>
                  {elsewhere && (
                    <span className="text-xs text-gray-400">
                      {
                        (categories ?? []).find(
                          (c) => c.id === item.category_id,
                        )?.name
                      }
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <Button
            className="w-full"
            busy={itemsMutation.isPending}
            onClick={() => itemsMutation.mutate()}
          >
            {t.save}
          </Button>
        </div>
      </Modal>
    </>
  );
}
