import { supabase } from "../supabase";
import { must } from "./helpers";
import type { Item } from "../types";

/** Catalog for pickers: active + approved only. */
export async function fetchCatalog(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("is_active", true)
    .eq("is_approved", true)
    .order("name");
  return must(data, error);
}

/** Admin view: everything, pending approvals first. */
export async function fetchAllItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("is_approved", { ascending: true })
    .order("name");
  return must(data, error);
}

/** PIC proposes a new catalog item — arrives unapproved (RLS-enforced). */
export async function proposeItem(
  name: string,
  unit: string,
  userId: string,
): Promise<Item> {
  const { data, error } = await supabase
    .from("items")
    .insert({
      name: name.trim(),
      default_unit: unit,
      is_approved: false,
      created_by: userId,
    })
    .select()
    .single();
  return must(data, error);
}

export async function createItem(input: {
  name: string;
  default_unit: string;
  emoji?: string | null;
  category_id?: string | null;
}): Promise<Item> {
  const { data, error } = await supabase
    .from("items")
    .insert({ ...input, name: input.name.trim() })
    .select()
    .single();
  return must(data, error);
}

export async function updateItem(
  id: string,
  patch: Partial<
    Pick<
      Item,
      "name" | "default_unit" | "emoji" | "is_active" | "is_approved" | "category_id"
    >
  >,
): Promise<Item> {
  const { data, error } = await supabase
    .from("items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return must(data, error);
}
