// Client side of Web Push: permission, subscription, and syncing the
// device subscription to the push_subscriptions table (RLS: own rows only).

import { supabase } from "./supabase";

// The VAPID *public* key is safe to ship in code (it identifies our push
// sender; the private half lives only in Supabase secrets). The env var can
// override it if the key pair is ever rotated.
const DEFAULT_VAPID_PUBLIC_KEY =
  "BJXMSUrHF5RLOIlnWzMfEkg2zAJyCT4FJYyJzCHfbqep28hLXNX8nVMBfj3Bb5z3axteMu0cRr58rnRlVJmdQY8";

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;

export function pushSupported(): boolean {
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
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}

/** Ask permission, subscribe this device, save the subscription server-side. */
export async function enablePush(
  userId: string,
): Promise<"enabled" | "denied"> {
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
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
  return "enabled";
}

/** Remove this device's subscription (server row first, then browser). */
export async function disablePush(): Promise<void> {
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
