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

// ---------------------------------------------------------------- token ----
// The FCM token arrives asynchronously, on a listener. Three things went
// wrong with the previous shape and between them they are why staff had
// notifications switched on and still heard nothing:
//
//  1. `tokenPromise` was created INSIDE initNativePushListeners, after an
//     `await import()`. A bell tap that beat that import found it still null,
//     and `await null` yields null — reported to the user as "denied" even
//     though Android had just granted the permission. The OS permission stuck,
//     so every later launch showed the bell as ON while no token was ever
//     saved. Exactly one device in ten would register, at random.
//  2. Nothing ever settled the promise if registration failed or Play Services
//     stayed quiet, so the bell span forever and the enable-notifications card
//     never appeared.
//  3. It resolved once, for all time. A token rotation had nobody listening.
//
// So: waiters are a list, every path settles them, and there is always a
// timeout. Created at module load, so there is no window to lose.
let lastToken: string | null = null;
const waiters: ((token: string | null) => void)[] = [];

function deliverToken(token: string | null): void {
  if (token) lastToken = token;
  while (waiters.length > 0) waiters.shift()!(token);
}

/** The FCM token, or null if Android does not produce one in time. */
function awaitToken(timeoutMs = 15_000): Promise<string | null> {
  if (lastToken) return Promise.resolve(lastToken);
  return new Promise((resolve) => {
    const handler = (token: string | null) => {
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => {
      const index = waiters.indexOf(handler);
      if (index >= 0) waiters.splice(index, 1);
      resolve(null);
    }, timeoutMs);
    waiters.push(handler);
  });
}

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
 * Does the server actually have THIS device against THIS user?
 *
 * RLS scopes the read to the caller's own rows, so a device that has changed
 * hands correctly reads as "not registered" and gets re-claimed.
 */
async function hasServerRow(token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", token)
    .maybeSingle();
  return !error && Boolean(data);
}

// -------------------------------------------------------------- listeners --
let listenersPromise: Promise<void> | null = null;
let openUrlHandler: ((url: string) => void) | null = null;

async function attachListeners(): Promise<void> {
  const { PushNotifications } = await pushPlugin();

  // PERMANENT, not one-shot: Android rotates FCM tokens on its own schedule
  // (app data cleared, restore to a new phone, Play Services refresh).
  // Re-saving on every fire is what keeps a device reachable long-term.
  await PushNotifications.addListener("registration", (token) => {
    deliverToken(token.value);
    void saveToken(token.value);
  });

  await PushNotifications.addListener("registrationError", (err) => {
    console.error("[push] FCM registration error", JSON.stringify(err));
    // Settle the waiters: a caller blocked on the token must fail fast, not
    // hang behind a spinner that never stops.
    deliverToken(null);
  });

  // Tapping a notification while the app is backgrounded or closed.
  await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      const url = action.notification.data?.url;
      if (typeof url === "string" && url) openUrlHandler?.(url);
    },
  );
}

/** Idempotent: every entry point awaits this before calling register(). */
function ensureListeners(): Promise<void> {
  listenersPromise ??= attachListeners();
  return listenersPromise;
}

/**
 * Attach the permanent listeners and remember where a tapped notification
 * should navigate. Called once per app launch from main.tsx.
 */
export async function initNativePushListeners(
  onOpenUrl: (url: string) => void,
): Promise<void> {
  if (!isNative) return;
  openUrlHandler = onOpenUrl;
  await ensureListeners();
}

/** Notifications are always available in the APK — Play Services handles it. */
export function nativePushSupported(): boolean {
  return isNative;
}

export async function isNativePushEnabled(): Promise<boolean> {
  if (!isNative) return false;
  const { PushNotifications } = await pushPlugin();
  if ((await PushNotifications.checkPermissions()).receive !== "granted") {
    return false;
  }
  // Permission is NOT reachability. The bell used to answer this question
  // with the OS permission alone, so a phone that had been granted permission
  // but never got a row into push_subscriptions displayed a confident 🔔 and
  // received nothing, forever. Ask the server whether it can actually reach
  // this device — that is what "enabled" means to the person reading it.
  const token = lastToken ?? (await awaitToken(4_000));
  return token ? await hasServerRow(token) : false;
}

/**
 * Register this device without prompting — mirrors ensurePushRegistered() on
 * the web. Runs every launch so a rotated or pruned token is restored.
 * Returns false (never throws) when permission has not been granted yet.
 */
export async function ensureNativePushRegistered(): Promise<boolean> {
  try {
    if (!isNative) return false;
    const { PushNotifications } = await pushPlugin();
    if ((await PushNotifications.checkPermissions()).receive !== "granted") {
      return false;
    }

    // Listeners first, always: register() is what makes Android emit the
    // token, and nothing is listening until this resolves.
    await ensureListeners();
    await PushNotifications.register();

    const token = await awaitToken();
    if (!token) return false;
    // The listener already saved it; this is the self-heal for a row that was
    // pruned after a failed send, or claimed by whoever used this phone last.
    return (await hasServerRow(token)) || (await saveToken(token));
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

  await ensureListeners();
  await PushNotifications.register();

  const token = await awaitToken();
  // Reaching here with no token means Android granted the permission and then
  // failed to mint one — a Play Services problem, not a refusal. Reporting it
  // as "denied" is what taught managers to stop trying; the OS permission is
  // already granted, so the next launch self-heals via ensure...Registered().
  if (!token) {
    console.error("[push] permission granted but no FCM token was issued");
    return "denied";
  }
  return (await saveToken(token)) ? "enabled" : "denied";
}

/**
 * Ask the OS for the notification permission at FIRST LAUNCH, before anyone
 * has signed in — what every other Android app does the moment it opens.
 *
 * Deliberately separate from saving the token. At first launch there is no
 * session yet, so register_push_subscription would refuse ("Not authorized").
 * What matters here is getting the permission and starting the token flow;
 * the token lands in `lastToken`, and ensureNativePushRegistered() writes it
 * to the server as soon as somebody signs in.
 *
 * On Android 12 and below notifications are granted at install time, so
 * checkPermissions() already says "granted" and this just registers.
 */
export async function requestNativePermission(): Promise<
  "granted" | "denied" | "skip"
> {
  if (!isNative) return "skip";
  try {
    const { PushNotifications } = await pushPlugin();
    let status = await PushNotifications.checkPermissions();

    if (status.receive !== "granted") {
      // Hard-denied at OS level: re-asking shows no dialog, only Settings can
      // undo it. Nothing to gain by asking again on every launch.
      if (status.receive === "denied") return "denied";
      status = await PushNotifications.requestPermissions();
      if (status.receive !== "granted") return "denied";
    }

    // Listeners BEFORE register(), or the token Android emits has no one
    // listening for it.
    await ensureListeners();
    await PushNotifications.register();
    return "granted";
  } catch (e) {
    console.error("[push] permission request failed", e);
    return "denied";
  }
}

/**
 * Ask for the notification permission WITHOUT waiting for the user to find
 * the bell — what every other Android app does on first launch.
 *
 * This is native-only and it has to be: on the web, Notification.requestPermission()
 * is only honoured from a real user gesture, which is why the prompt card
 * exists at all. Android has no such rule, so in the APK there is no reason to
 * make staff hunt for a switch before the app can reach them.
 *
 * "skip" means there is nothing to ask for — already granted (the caller's
 * ensure...Registered() handles that), or hard-denied at OS level, where
 * re-asking shows no dialog and only the system settings can undo it.
 */
export async function autoEnableNativePush(): Promise<
  "enabled" | "denied" | "skip"
> {
  if (!isNative) return "skip";
  try {
    const { PushNotifications } = await pushPlugin();
    const status = await PushNotifications.checkPermissions();
    if (status.receive === "granted") return "skip";
    if (status.receive === "denied") return "skip";
    return await enableNativePush();
  } catch (e) {
    console.error("[push] auto-enable failed", e);
    return "denied";
  }
}

/**
 * Stop notifications for this device.
 *
 * The OS permission itself can only be revoked by the user in system settings,
 * so what we can do — and what actually matters — is drop the server-side row
 * so nothing is dispatched here any more.
 */
export async function disableNativePush(): Promise<void> {
  const token = lastToken ?? (await awaitToken(4_000));
  if (token) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", token);
  }
  const { PushNotifications } = await pushPlugin();
  await PushNotifications.removeAllDeliveredNotifications();
}
