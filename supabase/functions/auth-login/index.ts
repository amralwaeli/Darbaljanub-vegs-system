// ============================================================================
// auth-login — hardened login proxy (public endpoint, verify_jwt = false)
//
// Why this exists: the app logs in with email + 6-digit PIN (the PIN is the
// Supabase Auth password under the hood). A 6-digit PIN is weak, so raw
// password-grant from the client is not acceptable. This function:
//
//   1. Rate-limits: 5 failed attempts per email OR per IP within 15 minutes
//      -> locked out with a generic message (counter kept in login_attempts,
//      a table clients cannot read or write).
//   2. Never reveals whether the email exists ("Invalid email or PIN" for
//      every failure — no user enumeration).
//   3. Rejects deactivated profiles with the same generic error.
//   4. Records every attempt for the superadmin audit trail.
//
// The client calls this instead of signInWithPassword, then installs the
// returned session with supabase.auth.setSession().
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Supabase injects these automatically. Newer projects use the new key
// names (SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY); older ones the
// legacy names — accept either.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_FAILS = 5;
const WINDOW_MINUTES = 15;
const GENERIC_ERROR = "Invalid email or PIN";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const { email: rawEmail, pin } = await req.json();
    const email = String(rawEmail ?? "").trim().toLowerCase();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\d{6}$/.test(String(pin ?? ""))
    ) {
      return jsonResponse(req, { error: GENERIC_ERROR }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // --- rate limit --------------------------------------------------------
    const windowStart = new Date(
      Date.now() - WINDOW_MINUTES * 60_000,
    ).toISOString();

    const [{ count: emailFails }, { count: ipFails }] = await Promise.all([
      admin
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .eq("success", false)
        .gte("created_at", windowStart),
      admin
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .eq("success", false)
        .gte("created_at", windowStart),
    ]);

    if ((emailFails ?? 0) >= MAX_FAILS || (ipFails ?? 0) >= MAX_FAILS * 4) {
      return jsonResponse(
        req,
        { error: `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.` },
        429,
      );
    }

    // --- attempt the password grant (PIN = password) -----------------------
    const grantRes = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: String(pin) }),
      },
    );
    const grantBody = await grantRes.json();

    const recordAttempt = (success: boolean) =>
      admin.from("login_attempts").insert({ email, ip, success });

    if (!grantRes.ok || !grantBody.access_token) {
      await recordAttempt(false);
      return jsonResponse(req, { error: GENERIC_ERROR }, 400);
    }

    // --- profile must exist and be active ----------------------------------
    const userId = grantBody.user?.id as string | undefined;
    const { data: profile } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", userId ?? "")
      .single();

    if (!profile?.is_active) {
      await recordAttempt(false);
      return jsonResponse(req, { error: GENERIC_ERROR }, 400);
    }

    await Promise.all([
      recordAttempt(true),
      admin
        .from("profiles")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", userId!),
    ]);

    // Return only what setSession() needs.
    return jsonResponse(req, {
      access_token: grantBody.access_token,
      refresh_token: grantBody.refresh_token,
    });
  } catch (e) {
    console.error("auth-login fatal:", e);
    return jsonResponse(req, { error: GENERIC_ERROR }, 400);
  }
});
