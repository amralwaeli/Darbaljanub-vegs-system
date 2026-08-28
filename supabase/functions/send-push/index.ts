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
//   FCM_SERVICE_ACCOUNT  — the Firebase service-account JSON, verbatim
//
// TWO TRANSPORTS (see migration 0018). Every row carries a `platform`:
//   web     -> Web Push / VAPID, exactly as before
//   android -> FCM HTTP v1, for the native app
//
// They are independent: whichever is configured gets used, and a failure in
// one never blocks the other. Notifications stopped arriving in the old TWA
// precisely because Web Push is delivered to CHROME, whose background process
// Android OEM battery managers kill. FCM is delivered by Play Services
// straight to the app, which the OS wakes.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";

// Injected automatically; new-format key names first, legacy as fallback.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const APP_URL = Deno.env.get("APP_URL") ?? "/";
const FCM_SERVICE_ACCOUNT = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Parsed once at cold start; null simply means "FCM not configured". */
const serviceAccount: ServiceAccount | null = (() => {
  if (!FCM_SERVICE_ACCOUNT) return null;
  try {
    const parsed = JSON.parse(FCM_SERVICE_ACCOUNT) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.error("FCM_SERVICE_ACCOUNT is missing required fields");
      return null;
    }
    return parsed;
  } catch (e) {
    console.error("FCM_SERVICE_ACCOUNT is not valid JSON:", e);
    return null;
  }
})();

// All staff are Arabic speakers — notifications are sent in Arabic.
// Each message is written for the ROLE that receives it (see 0010 for the
// event -> recipient matrix), never as a generic broadcast.
const MESSAGES = {
  request_submitted: (store: string) => ({
    title: "🛒 طلب جديد",
    body: `أرسل ${store} طلب اليوم — يمكنك إرساله إلى السوق عبر واتساب`,
  }),
  order_sent: () => ({
    title: "📤 أُرسل الطلب",
    body: "أُرسل طلب اليوم إلى السوق — لا يمكن تعديل القائمة بعد الآن",
  }),
  costs_ready: () => ({
    title: "💰 الأسعار جاهزة",
    body: "أدخل المدير أسعار التكلفة — حدّد أسعار البيع الآن",
  }),
  deliveries_ready: () => ({
    title: "📦 حمولات جاهزة",
    body: "تم الشراء — الحمولات جاهزة للتحميل والتوصيل",
  }),
  delivery_loaded: (store: string) => ({
    title: "🚚 تم التحميل",
    body: `تم تحميل بضاعة ${store} — في الطريق`,
  }),
  delivery_offloaded: (store: string) => ({
    title: "📦 وصلت البضاعة",
    body: `تم تنزيل بضاعة ${store} — يرجى تأكيد الاستلام`,
  }),
  delivery_received: (store: string) => ({
    title: "✅ تم الاستلام",
    body: `أكد ${store} استلام البضاعة`,
  }),
} as const;

// ----------------------------------------------------------- FCM plumbing --
// FCM HTTP v1 authenticates with a short-lived OAuth token minted from the
// service account, so we sign a JWT and exchange it. Web Crypto does the RS256
// signing, so this adds no dependency.

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  // Service-account JSON often stores newlines escaped as \n — normalise
  // before stripping the armour, or atob() chokes.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  // The ArrayBuffer, not the view: importKey wants a BufferSource whose
  // backing buffer is definitely an ArrayBuffer, and a Uint8Array typed as
  // ArrayBufferLike fails that check under a strict deploy.
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

// Access tokens last an hour; a warm instance reuses one rather than paying a
// round-trip per notification.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function fcmAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  try {
    const encoder = new TextEncoder();
    const segment = (obj: unknown) =>
      base64Url(encoder.encode(JSON.stringify(obj)));

    const unsigned =
      segment({ alg: "RS256", typ: "JWT" }) +
      "." +
      segment({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      });

    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(sa.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      encoder.encode(unsigned),
    );

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: unsigned + "." + base64Url(new Uint8Array(signature)),
      }),
    });

    if (!response.ok) {
      console.error("FCM token exchange failed:", await response.text());
      return null;
    }

    const json = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    cachedToken = {
      value: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600),
    };
    return cachedToken.value;
  } catch (e) {
    console.error("FCM token mint failed:", e);
    return null;
  }
}

/** "sent" | "dead" | "failed" — "dead" is the only signal that prunes a row. */
async function sendFcm(
  token: string,
  accessToken: string,
  projectId: string,
  message: { title: string; body: string },
): Promise<"sent" | "dead" | "failed"> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          // The app reads `path` when the notification is tapped. It is
          // app-relative on purpose: the APK has no /<repo>/ base, unlike the
          // website, so a full URL would not route.
          data: { url: APP_URL, path: "/" },
          android: {
            // Market days are time-critical; these must not be batched.
            priority: "HIGH",
            notification: { sound: "default", default_vibrate_timings: true },
          },
        },
      }),
    },
  );

  if (response.ok) return "sent";

  const body = await response.text();
  // A token dies when the app is uninstalled or its data cleared. Only these
  // two signals are trusted for deletion — never a generic 400, which could be
  // our own payload bug and would wipe every live device.
  const unregistered = response.status === 404 || /UNREGISTERED/.test(body);
  if (!unregistered) {
    console.error("FCM send failed:", response.status, body.slice(0, 200));
  }
  return unregistered ? "dead" : "failed";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  // Constant secret comparison — pg_net is the only intended caller.
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const webPushReady = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);

  let event: string;
  // Shape varies by event (a store_requests row, an order_cycles row, a
  // deliveries row); each branch below reads only the fields it knows.
  // deno-lint-ignore no-explicit-any
  let record: any;
  try {
    ({ event, record } = await req.json());
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // ---------------------------------------------------------- __status__ ---
  // Which transports are actually configured on THIS deployment. Secret-gated
  // like everything else, and it reports booleans only — no keys, no data.
  //
  // It exists because the failure it diagnoses is completely silent: an unset
  // FCM_SERVICE_ACCOUNT makes every android row a no-op, and the only trace
  // is a log line nobody reads. "Notifications don't work" was unanswerable
  // from outside the project without this.
  if (event === "__status__") {
    return new Response(
      JSON.stringify({
        webPush: webPushReady,
        fcm: Boolean(serviceAccount),
        fcmProject: serviceAccount?.project_id ?? null,
        vapidSubject: VAPID_SUBJECT,
        appUrl: APP_URL,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Either transport alone is useful; only having neither is a misconfig.
  if (!webPushReady && !serviceAccount) {
    console.error("neither VAPID keys nor FCM_SERVICE_ACCOUNT configured");
    return new Response("not configured", { status: 500 });
  }
  if (webPushReady) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {

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

    // Everyone holding one of these roles, active only.
    const byRole = async (...roles: string[]): Promise<string[]> => {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .in("role", roles)
        .eq("is_active", true);
      return (data ?? []).map((p) => p.id);
    };

    if (event === "request_submitted") {
      userIds = await byRole("manager", "superadmin");
      message = MESSAGES.request_submitted(await storeName(record.store_id));
    } else if (event === "order_sent") {
      userIds = await byRole("pic");
      message = MESSAGES.order_sent();
    } else if (event === "costs_ready") {
      userIds = await byRole("pic");
      message = MESSAGES.costs_ready();
    } else if (event === "deliveries_ready") {
      userIds = await byRole("driver");
      message = MESSAGES.deliveries_ready();
    } else if (event === "delivery_loaded") {
      // Managers plus the one PIC whose store this delivery belongs to.
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("is_active", true)
        .or(
          `role.in.(manager,superadmin),and(role.eq.pic,store_id.eq.${record.store_id})`,
        );
      userIds = (data ?? []).map((p) => p.id);
      message = MESSAGES.delivery_loaded(await storeName(record.store_id));
    } else if (event === "delivery_offloaded") {
      // The shop is the one who has to act next, so they lead the recipients.
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("is_active", true)
        .or(
          `role.in.(manager,superadmin),and(role.eq.pic,store_id.eq.${record.store_id})`,
        );
      userIds = (data ?? []).map((p) => p.id);
      message = MESSAGES.delivery_offloaded(await storeName(record.store_id));
    } else if (event === "delivery_received") {
      userIds = await byRole("manager", "superadmin");
      message = MESSAGES.delivery_received(await storeName(record.store_id));
    } else {
      return new Response("unknown event", { status: 400 });
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // ------------------------------------------------- load & send ---------
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, platform")
      .in("user_id", userIds);

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: APP_URL,
    });

    let sent = 0;
    const dead: string[] = [];

    // One OAuth token covers every android row in this dispatch.
    const accessToken =
      serviceAccount && (subs ?? []).some((row) => row.platform === "android")
        ? await fcmAccessToken(serviceAccount)
        : null;

    await Promise.all(
      (subs ?? []).map(async (sub) => {
        // --- native app: FCM ---
        if (sub.platform === "android") {
          if (!accessToken || !serviceAccount) return;
          try {
            const result = await sendFcm(
              sub.endpoint,
              accessToken,
              serviceAccount.project_id,
              message,
            );
            if (result === "sent") sent++;
            else if (result === "dead") dead.push(sub.id);
          } catch (err) {
            console.error("FCM send threw:", err);
          }
          return;
        }

        // --- website: Web Push (unchanged) ---
        if (!webPushReady) return;
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
