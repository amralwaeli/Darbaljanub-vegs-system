// ============================================================================
// send-push — Web Push dispatcher (verify_jwt = false; secured by a shared
// secret header that only the database triggers know).
//
// Called by pg_net from the notify_push() trigger with:
//   { event: "request_submitted" | "delivery_loaded" | "costs_ready",
//     record: <the row that fired the trigger> }
//
// Resolves recipients per event, loads their device subscriptions and sends
// a Web Push (VAPID) to each. Dead subscriptions (404/410) are pruned.
//
// Required secrets (supabase secrets set ...):
//   PUSH_WEBHOOK_SECRET  — same value as app_config.push_webhook_secret
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — from: npx web-push generate-vapid-keys
//   VAPID_SUBJECT        — mailto:you@example.com
//   APP_URL              — the deployed PWA URL (notification click target)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const APP_URL = Deno.env.get("APP_URL") ?? "/";

// All staff are Arabic speakers — notifications are sent in Arabic.
const MESSAGES = {
  request_submitted: (store: string) => ({
    title: "🛒 طلب جديد",
    body: `أرسل ${store} طلب اليوم`,
  }),
  delivery_loaded: (store: string) => ({
    title: "🚚 تم التحميل",
    body: `تم تحميل بضاعة ${store} — في الطريق`,
  }),
  costs_ready: () => ({
    title: "💰 الأسعار جاهزة",
    body: "أدخل المدير أسعار التكلفة — حدّد أسعار البيع الآن",
  }),
} as const;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  // Constant secret comparison — pg_net is the only intended caller.
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("VAPID keys not configured");
    return new Response("not configured", { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { event, record } = await req.json();

    // ---------------------------------------------- resolve recipients -----
    let userIds: string[] = [];
    let message: { title: string; body: string };

    const storeName = async (storeId: string): Promise<string> => {
      const { data } = await admin
        .from("stores")
        .select("name")
        .eq("id", storeId)
        .single();
      return data?.name ?? "محل";
    };

    if (event === "request_submitted") {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .in("role", ["manager", "superadmin"])
        .eq("is_active", true);
      userIds = (data ?? []).map((p) => p.id);
      message = MESSAGES.request_submitted(await storeName(record.store_id));
    } else if (event === "delivery_loaded") {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("is_active", true)
        .or(
          `role.in.(manager,superadmin),and(role.eq.pic,store_id.eq.${record.store_id})`,
        );
      userIds = (data ?? []).map((p) => p.id);
      message = MESSAGES.delivery_loaded(await storeName(record.store_id));
    } else if (event === "costs_ready") {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "pic")
        .eq("is_active", true);
      userIds = (data ?? []).map((p) => p.id);
      message = MESSAGES.costs_ready();
    } else {
      return new Response("unknown event", { status: 400 });
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // ------------------------------------------------- load & send ---------
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds);

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: APP_URL,
    });

    let sent = 0;
    const dead: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { TTL: 3600 },
          );
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 0;
          if (status === 404 || status === 410) {
            dead.push(sub.id); // device unsubscribed / app uninstalled
          } else {
            console.error("push failed:", status, sub.endpoint.slice(0, 50));
          }
        }
      }),
    );

    if (dead.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", dead);
    }

    return new Response(JSON.stringify({ sent, pruned: dead.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-push fatal:", e);
    return new Response("error", { status: 500 });
  }
});
