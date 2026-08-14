// ============================================================================
// invite-user — privileged user management (Deno / Supabase Edge Function)
//
// Actions (POST JSON):
//   { action: "invite",   email, role, store_id? }  -> send invite email + create profile
//   { action: "reinvite", email }                   -> send PIN-reset (recovery) email
//   { action: "set_active", user_id, is_active }    -> activate / deactivate a user
//
// Security:
//   * Requires a valid JWT (verify_jwt = true) — caller must be logged in.
//   * Caller's role is read from the `profiles` TABLE (server truth), never
//     from client-supplied claims.
//   * Only manager/superadmin may call; only superadmin may mint superadmins
//     or touch superadmin accounts.
//   * The service-role key exists only here (Supabase secret), never client-side.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Where invite/recovery emails land. Set secret APP_URL to your deployed origin.
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const VALID_ROLES = ["superadmin", "manager", "pic", "driver"] as const;
type Role = (typeof VALID_ROLES)[number];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    // --- authenticate the caller -------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !caller) {
      return jsonResponse(req, { error: "Not authenticated" }, 401);
    }

    // --- authorize from the profiles table (server truth) ------------------
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("id", caller.id)
      .single();

    if (
      !callerProfile ||
      !callerProfile.is_active ||
      !["manager", "superadmin"].includes(callerProfile.role)
    ) {
      return jsonResponse(req, { error: "Not authorized" }, 403);
    }
    const callerRole = callerProfile.role as Role;

    const body = await req.json();
    const action = String(body.action ?? "invite");

    // ------------------------------------------------------------ invite ---
    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "") as Role;
      const storeId = body.store_id ? String(body.store_id) : null;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return jsonResponse(req, { error: "Invalid email" }, 400);
      }
      if (!VALID_ROLES.includes(role)) {
        return jsonResponse(req, { error: "Invalid role" }, 400);
      }
      // Only superadmin can create another superadmin.
      if (role === "superadmin" && callerRole !== "superadmin") {
        return jsonResponse(req, { error: "Only a superadmin can invite a superadmin" }, 403);
      }
      if (role === "pic" && !storeId) {
        return jsonResponse(req, { error: "A PIC must be assigned to a store" }, 400);
      }

      const { data: invited, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${APP_URL}/accept-invite`,
        });
      if (inviteError || !invited?.user) {
        // Generic message: do not leak whether the email already exists.
        console.error("invite error:", inviteError?.message);
        return jsonResponse(req, { error: "Could not send invite" }, 400);
      }

      const { error: profileError } = await admin.from("profiles").upsert({
        id: invited.user.id,
        role,
        store_id: role === "pic" ? storeId : null,
        is_active: true,
      });
      if (profileError) {
        console.error("profile error:", profileError.message);
        return jsonResponse(req, { error: "Could not create profile" }, 500);
      }

      if (role === "pic" && storeId) {
        await admin.from("stores").update({ pic_id: invited.user.id }).eq("id", storeId);
      }

      return jsonResponse(req, { ok: true, user_id: invited.user.id });
    }

    // ---------------------------------------------------------- reinvite ---
    // PIN reset: send a recovery link; the accept-invite page lets the user
    // set a new PIN. Response is identical whether or not the email exists.
    if (action === "reinvite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse(req, { error: "Invalid email" }, 400);
      }
      const anonClient = createClient(SUPABASE_URL, ANON_KEY);
      await anonClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${APP_URL}/accept-invite`,
      });
      return jsonResponse(req, { ok: true });
    }

    // -------------------------------------------------------- set_active ---
    if (action === "set_active") {
      const userId = String(body.user_id ?? "");
      const isActive = Boolean(body.is_active);
      if (!userId) return jsonResponse(req, { error: "user_id required" }, 400);

      const { data: target } = await admin
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      if (!target) return jsonResponse(req, { error: "User not found" }, 404);
      // Managers may only (de)activate PICs and drivers.
      if (callerRole === "manager" && !["pic", "driver"].includes(target.role)) {
        return jsonResponse(req, { error: "Not authorized for this user" }, 403);
      }

      const { error } = await admin
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", userId);
      if (error) return jsonResponse(req, { error: "Update failed" }, 500);

      // RLS (is_active_user()) already blocks a deactivated user's every
      // request. On top, ban the auth user so token refresh fails too.
      await admin.auth.admin
        .updateUserById(userId, { ban_duration: isActive ? "none" : "87600h" })
        .catch(() => {});
      return jsonResponse(req, { ok: true });
    }

    return jsonResponse(req, { error: "Unknown action" }, 400);
  } catch (e) {
    console.error("invite-user fatal:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
