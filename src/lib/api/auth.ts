import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabase";
import { ApiError } from "./helpers";
import { t } from "../../i18n/strings";

/**
 * Login goes through the auth-login Edge Function — NEVER directly through
 * signInWithPassword — so the server can rate-limit PIN guessing and keep
 * error messages enumeration-safe.
 */
export async function loginWithPin(email: string, pin: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/auth-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email, pin }),
    });
  } catch (e) {
    throw new ApiError(t.offline, e);
  }

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };

  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new ApiError(body.error ?? t.loginFailed);
  }

  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (error) throw new ApiError(t.loginFailed, error);
}

/** Invite flow: the invited user sets their display name + PIN. */
export async function completeAccountSetup(
  username: string,
  pin: string,
): Promise<void> {
  const { error: pwError } = await supabase.auth.updateUser({ password: pin });
  if (pwError) throw new ApiError(t.errorGeneric, pwError);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError(t.sessionExpired);

  const { error } = await supabase
    .from("profiles")
    .update({ username })
    .eq("id", user.id);
  if (error) throw new ApiError(t.errorGeneric, error);
}
