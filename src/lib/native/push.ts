// ============================================================================
// Native push (FCM).
//
// WHY THIS EXISTS: in the TWA, notifications were Web Push delivered to
// CHROME. Android OEM battery managers kill Chrome's background process, so
// they silently never arrived. FCM is delivered by Google Play Services at OS
// level directly to this app, which Android wakes even when it is closed.
//
// The token is stored server-side through the SAME RPC the web path uses
// (register_push_subscription, 0016/0018) — an FCM token identifies a device
// exactly as a Web Push endpoint does, so the "endpoint follows the device"
// claim semantics apply unchanged.
// ============================================================================

import { supabase } from "../supabase";
import { isNative } from "./index";

type PushModule = typeof import("@capacitor/push-notifications");

let modulePromise: Promise<PushModule> | null = null;
function pushPlugin(): Promise<PushModule> {
  modulePromise ??= import("@capacitor/push-notifications");
  return modulePromise;
}

/** Resolves with the FCM token once Android hands one over. */
let tokenPromise: Promise<string> | null = null;
let listenersReady = false;

/** Persist a token against the signed-in user. Safe to call repeatedly. */
async function saveToken(token: string): Promise<boolean> {
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: token,
    p_p256dh: "",
    p_auth: "",
    p_platform: "android",
  });
  if (error) console.error("[push] token save failed", error.message);
  return !error;
}

/**
 * Attach the permanent listeners. Called once per app launch.
 *
 * The `registration` listener is deliberately PERMANENT rather than one-shot:
 * Android rotates FCM tokens on its own schedule (app data cleared, restore to
 * a new phone, Play Services refresh). Re-saving on every fire is what keeps a
 * device reachable long-term instead of going quietly dark.
 *
 * `onOpenUrl` receives the deep link from a tapped notification.
 */
export async function initNativePushListeners(
  onOpenUrl: (url: string) => void,
): Promise<void> {
  if (!isNative || listenersReady) return;
  listenersReady = true;

  const { PushNotifications } = await pushPlugin();

  tokenPromise = new Promise<string>((resolve) => {
    void PushNotifications.addListener("registration", (token) => {
      resolve(token.value);
      void saveToken(token.value);
    });
  });

  await PushNotifications.addListener("registrationError", (err) => {
    console.error("[push] FCM registration error", JSON.stringify(err));
  });

  // Tapping a notification while the app is backgrounded or closed.
  await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      const url = action.notification.data?.url;
      if (typeof url === "string" && url) onOpenUrl(url);
    },
  );
}

/** Notifications are always available in the APK — Play Services handles it. */
export function nativePushSupported(): boolean {
  return isNative;
}

export async function isNativePushEnabled(): Promise<boolean> {
  if (!isNative) return false;
  const { PushNotifications } = await pushPlugin();
  return (await PushNotifications.checkPermissions()).receive === "granted";
}

/**
 * Register this device without prompting — mirrors ensurePushRegistered() on
 * the web. Runs every launch so a rotated or pruned token is restored.
 * Returns false (never throws) when permission has not been granted yet.
 */
export async function ensureNativePushRegistered(): Promise<boolean> {
  try {
    if (!(await isNativePushEnabled())) return false;
    const { PushNotifications } = await pushPlugin();
    await PushNotifications.register();
    // The listener persists the token; awaiting it just reports success.
    return Boolean(await tokenPromise);
  } catch (e) {
    console.error("[push] ensure failed", e);
    return false;
  }
}

/** Ask permission (Android 13+ shows a system dialog), then register. */
export async function enableNativePush(): Promise<"enabled" | "denied"> {
  const { PushNotifications } = await pushPlugin();

  let status = await PushNotifications.checkPermissions();
  if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
    status = await PushNotifications.requestPermissions();
  }
  if (status.receive !== "granted") return "denied";

  await PushNotifications.register();
  const token = await tokenPromise;
  if (!token) return "denied";
  return (await saveToken(token)) ? "enabled" : "denied";
}

/**
 * Stop notifications for this device.
 *
 * The OS permission itself can only be revoked by the user in system settings,
 * so what we can do — and what actually matters — is drop the server-side row
 * so nothing is dispatched here any more.
 */
export async function disableNativePush(): Promise<void> {
  const token = await tokenPromise;
  if (token) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", token);
  }
  const { PushNotifications } = await pushPlugin();
  await PushNotifications.removeAllDeliveredNotifications();
}
