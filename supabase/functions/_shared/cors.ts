// Shared CORS headers for Edge Functions.
//
// ALLOWED_ORIGIN is a Supabase secret holding the origins allowed to call
// these functions — a comma-separated list, e.g.
//   https://amralwaeli.github.io,https://vegs.example.com
// Unset falls back to "*" for local development.
//
// IMPORTANT — the native app: the APK's WebView serves the bundle from its own
// origin (https://localhost on Android, capacitor://localhost on iOS), NOT
// from the website's origin. Those origins can never be part of a deployed
// site's ALLOWED_ORIGIN, so they are allowed unconditionally here. Without
// them the WebView blocks every Edge Function response and the app can only
// report "cannot reach the server" — login is impossible in the APK while the
// identical website works.
const NATIVE_ORIGINS = [
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
];

// `npm run dev` serves on http://localhost:5173, and Vite picks another port
// when that one is taken.
const isLocalDev = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

function allowOrigin(req: Request): string {
  const configured = (Deno.env.get("ALLOWED_ORIGIN") ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (configured.includes("*")) return "*";

  const origin = req.headers.get("Origin") ?? "";
  if (
    origin &&
    (configured.includes(origin) ||
      NATIVE_ORIGINS.includes(origin) ||
      isLocalDev(origin))
  ) {
    // Echo the caller's own origin: an allowlist of more than one origin
    // cannot be expressed in a single Access-Control-Allow-Origin header.
    return origin;
  }

  // Not allowed — answer with the primary origin so the browser blocks it.
  return configured[0] ?? "*";
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // The response body is identical for every caller but this header is not,
    // so any cache in front of the function must key on Origin.
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(req),
  });
}
