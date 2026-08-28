// Client side of push notifications: permission, subscription, and syncing the
// device registration to the push_subscriptions table (RLS: own rows only).
//
// TWO TRANSPORTS, ONE API. The website uses Web Push (VAPID) exactly as it
// always has. The Android app uses FCM, because Web Push is delivered to
// Chrome — whose background process OEM battery managers kill — and because
// the Push API does not exist in Android's WebView at all.
//
// Everything below dispatches to native/push.ts when running in the APK; the
// web implementations are unchanged.

import { supabase } from "./supabase";
import { isNative } from "./native/index";
import {
  disableNativePush,
  enableNativePush,
  ensureNativePushRegistered,
  isNativePushEnabled,
  nativePushSupported,
} from "./native/push";

// The VAPID *public* key is safe to ship in code (it identifies our push
// sender; the private half lives only in Supabase secrets). The env var can
// override it if the key pair is ever rotated.
const DEFAULT_VAPID_PUBLIC_KEY =
  "BJXMSUrHF5RLOIlnWzMfEkg2zAJyCT4FJYyJzCHfbqep28hLXNX8nVMBfj3Bb5z3axteMu0cRr58rnRlVJmdQY8";

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;

export function pushSupported(): boolean {
  if (isNative) return nativePushSupported();
  return (
    VAPID_PUBLIC_KEY !== "" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

export async function isPushEnabled(): Promise<boolean> {
  if (isNative) return isNativePushEnabled();
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  // A browser subscription the SERVER does not know about receives nothing.
  // That is not a hypothetical: send-push prunes an endpoint the moment it
  // 404s, and the bell went on claiming "notifications are on" afterwards.
  // RLS scopes this to the caller's own rows, so an endpoint now owned by
  // whoever signed in here last also correctly reads as off.
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", subscription.endpoint)
    .maybeSingle();
  return !error && Boolean(data);
}

/**
 * Register this device WITHOUT prompting — the closest thing to "on by
 * default" that a browser permits.
 *
 * Runs on every launch. If permission was already granted at some point, this
 * silently (re)creates the subscription and writes the row back, covering the
 * cases that quietly leave a user unreachable: an endpoint we pruned after a
 * failed send, a rotated endpoint, a reinstall, a cleared table.
 *
 * Returns false and never throws when permission has not been granted — only
 * a real user tap can obtain it, so enablePush() handles that path.
 */
export async function ensurePushRegistered(): Promise<boolean> {
  if (isNative) return ensureNativePushRegistered();
  try {
    if (!pushSupported() || Notification.permission !== "granted") return false;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const { error } = await supabase.rpc("register_push_subscription", {
      p_endpoint: subscription.endpoint,
      p_p256dh: json.keys?.p256dh ?? "",
      p_auth: json.keys?.auth ?? "",
      p_platform: "web",
    });
    return !error;
  } catch {
    return false;
  }
}

/** Ask permission, subscribe this device, save the subscription server-side. */
/** The owner comes from the JWT server-side — the client cannot assert it. */
export async function enablePush(): Promise<"enabled" | "denied"> {
  if (isNative) return enableNativePush();

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  // Via RPC, not a direct upsert: this browser's endpoint may already belong
  // to whoever used the app here before, and RLS rightly forbids updating
  // another user's row. See 0016 — the endpoint follows the device.
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_platform: "web",
  });
  if (error) throw new Error(error.message);
  return "enabled";
}

/** Remove this device's subscription (server row first, then browser). */
export async function disablePush(): Promise<void> {
  if (isNative) return disableNativePush();

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }
}
