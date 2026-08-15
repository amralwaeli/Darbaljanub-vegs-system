import { supabase } from "../supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { must, ApiError } from "./helpers";
import { t } from "../../i18n/strings";
import type { Store, ProfileWithStore, AuditEntry } from "../types";
import type { UserRole } from "../database.types";

// ------------------------------------------------------------------ stores --
export async function fetchStores(): Promise<Store[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .order("name");
  return must(data, error);
}

export async function createStore(input: {
  name: string;
  address?: string | null;
}): Promise<Store> {
  const { data, error } = await supabase
    .from("stores")
    .insert(input)
    .select()
    .single();
  return must(data, error);
}

export async function updateStore(
  id: string,
  patch: Partial<Pick<Store, "name" | "address" | "pic_id" | "is_active">>,
): Promise<Store> {
  const { data, error } = await supabase
    .from("stores")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return must(data, error);
}

// ------------------------------------------------------------------- users --
export async function fetchUsers(): Promise<ProfileWithStore[]> {
  const { data, error } = await supabase
    .from("profiles")
    // Disambiguated FK: profiles<->stores has TWO relationships — this one
    // (profiles.store_id) and stores.pic_id pointing back. A bare
    // `stores(...)` embed is rejected with PGRST201, which silently emptied
    // the users list. Every other table embeds stores by a single FK.
    .select("*, store:stores!profiles_store_id_fkey(id,name)")
    .order("created_at")
    .returns<ProfileWithStore[]>();
  return must(data, error);
}

/** Manager/superadmin: change a user's store assignment (or role). */
export async function updateUserAdmin(
  id: string,
  patch: { role?: UserRole; store_id?: string | null },
): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", id);
  must(true, error);
}

// ------------------------------------------- privileged (Edge Function) ----
async function invokeInviteFn(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke("invite-user", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = (await error.context.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new ApiError(detail?.error ?? t.errorGeneric, error);
    }
    throw new ApiError(t.errorGeneric, error);
  }
}

export function inviteUser(input: {
  email: string;
  role: UserRole;
  store_id?: string | null;
}): Promise<void> {
  return invokeInviteFn({ action: "invite", ...input });
}

/** PIN reset — sends a recovery email; user sets a new PIN on accept-invite. */
export function reinviteUser(email: string): Promise<void> {
  return invokeInviteFn({ action: "reinvite", email });
}

export function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<void> {
  return invokeInviteFn({
    action: "set_active",
    user_id: userId,
    is_active: isActive,
  });
}

// ------------------------------------------------------------------- audit --
export async function fetchAuditLog(limit = 200): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return must(data, error);
}
