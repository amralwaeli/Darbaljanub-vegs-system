// Shared CORS headers for Edge Functions.
// ALLOWED_ORIGIN is a Supabase secret (set it to your deployed PWA origin,
// e.g. https://vegs.vercel.app). Falls back to * for local development.
export function corsHeaders(req: Request): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin":
      allowed === "*" ? "*" : origin === allowed ? allowed : allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
