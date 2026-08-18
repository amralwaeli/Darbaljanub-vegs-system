// Categories (0019) — how the manager groups the catalogue: البطاطس والبصل,
// الورقيات, الخضار, الفواكه, الفواكه المستوردة, and any the manager adds later.
//
// Both items and vendors point at one category, so a submitted request can be
// read one category at a time and ordered from the vendor who supplies it.

import { supabase } from "../supabase";
import { must } from "./helpers";
import type { Category } from "../types";

/** Manager's display order first, then name — matches categories_sort_idx. */
const ORDERED = (query: ReturnType<typeof categoriesTable>) =>
  query.order("sort_order").order("name");

function categoriesTable() {
  return supabase.from("categories").select("*");
}

/** Active categories, for pickers and grouping. */
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await ORDERED(categoriesTable()).eq(
    "is_active",
    true,
  );
  return must(data, error);
}

/** Admin view: includes deactivated ones so they can be turned back on. */
export async function fetchAllCategories(): Promise<Category[]> {
  const { data, error } = await ORDERED(categoriesTable());
  return must(data, error);
}

export async function createCategory(input: {
  name: string;
  emoji?: string | null;
  sort_order?: number;
}): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .insert({ ...input, name: input.name.trim() })
    .select()
    .single();
  return must(data, error);
}

export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, "name" | "emoji" | "sort_order" | "is_active">>,
): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return must(data, error);
}

/**
 * File a set of items under a category in one go — the "pick this category's
 * items from the catalogue" screen.
 *
 * Passing an empty `itemIds` clears the category from everything currently in
 * it, which is what unticking every box should mean.
 *
 * ONE server-side call on purpose. Doing it as two UPDATEs from here (clear,
 * then set) meant a dropped connection between them — routine on a phone —
 * left the category empty and everything in it silently unfiled. The function
 * body is a single transaction (0019).
 */
export async function setCategoryItems(
  categoryId: string,
  itemIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc("set_category_items", {
    p_category_id: categoryId,
    p_item_ids: itemIds,
  });
  must(true, error);
}
