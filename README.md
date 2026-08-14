# Darb Al-Janub Vegetables — Procurement & Distribution PWA

A multi-store vegetable procurement system: store PICs request items, the
manager aggregates and orders from market vendors via WhatsApp, enters cost
prices, and drivers load per-store deliveries with mandatory photo proof.

Installable once on any phone (Android/iOS) or desktop — **auto-updates
silently on every deploy, no reinstalls ever**.

| Role | Can do |
|---|---|
| **SuperAdmin** | Everything, incl. user management, audit log, delete anything |
| **Manager** | See all requests (per-store + aggregated), WhatsApp vendor orders, enter cost prices, manage stores/items/vendors, invite users |
| **Store PIC** | Own store's request only; sees cost prices after purchase; sets selling prices; confirms receipt |
| **Driver** | Per-store delivery checklists + photo proof + "Loaded" — **never sees any price** |

Stack: React + Vite + TypeScript + Tailwind · TanStack Query · Supabase
(Postgres/Auth/Storage/Realtime/Edge Functions, free tier) · vite-plugin-pwa.

---

## 1. Project structure

```
supabase/
  migrations/           0001..0007 — run these IN ORDER in the SQL editor
  functions/
    auth-login/         hardened PIN login (rate limit, no enumeration)
    invite-user/        invite / PIN-reset / activate-deactivate users
  config.toml           per-function JWT settings (for CLI deploys)
src/
  lib/                  supabase client, DB types, api layer, utilities
  features/             auth / requests (PIC) / purchasing (Manager) /
                        deliveries (Driver) / admin / cycles
  components/           shared UI (mobile-first, 48px+ touch targets)
  i18n/strings.ts       ALL user-facing text (Arabic/RTL-ready)
scripts/
  seed.mjs              demo users (local only, needs service-role key)
  generate-icons.ps1    regenerates public/icons/*.png
docs/
  ARCHITECTURE.md       diagrams + order-cycle state machine
  TEST_CHECKLIST.md     manual test script per role + RLS verification
```

## 2. Supabase setup (exact steps)

1. **Create a project** at [supabase.com](https://supabase.com) (free tier).
2. **Run migrations**: SQL Editor → paste & run each file from
   `supabase/migrations/` **in numeric order** (0001 → 0007). Each runs clean
   on a fresh project.
3. **Auth settings** (Authentication → Sign In / Providers):
   - Email provider: enabled.
   - **Turn OFF "Allow new users to sign up"** — this system is invite-only.
     (Invites from the Edge Function still work; public signup is closed.)
4. **Auth URLs** (Authentication → URL Configuration) — GitHub Pages project
   sites live under `https://<user>.github.io/<repo>/`:
   - Site URL: `https://<user>.github.io/<repo>`
   - Additional redirect URLs:
     `https://<user>.github.io/<repo>/accept-invite` and, for local dev,
     `http://localhost:5173/accept-invite`
5. **Edge Functions** — with the [Supabase CLI](https://supabase.com/docs/guides/cli)
   (`npx supabase login`, `npx supabase link --project-ref <ref>`):
   ```sh
   # APP_URL includes the repo path; ALLOWED_ORIGIN is the ORIGIN ONLY
   # (browsers send Origin without any path).
   npx supabase secrets set APP_URL=https://<user>.github.io/<repo> ALLOWED_ORIGIN=https://<user>.github.io
   npx supabase functions deploy invite-user
   npx supabase functions deploy auth-login --no-verify-jwt
   ```
   (`auth-login` must be public — callers aren't logged in yet; it rate-limits
   itself. `config.toml` records this for CLI deploys.)
6. **Storage**: the `delivery-photos` bucket (private, 1 MB cap, jpeg/webp
   only) is created by migration 0005 — nothing to click.
7. **Seed demo data** (optional, local):
   ```sh
   # .env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (NEVER commit; never in frontend)
   npm run seed
   ```
   Demo logins → `admin@demo.local`/`111111`, `manager@demo.local`/`222222`,
   `pic-a@demo.local`/`333333`, `pic-b@demo.local`/`444444`,
   `driver@demo.local`/`555555`. **Delete or re-PIN these before real use.**

## 3. Local development

```sh
npm install
copy .env.example .env    # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

## 4. Deploy (GitHub Pages, free)

The repo ships a ready workflow: [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

1. Push this project to a GitHub repository (branch `main`).
2. Repo **Settings → Pages → Source: "GitHub Actions"**.
3. Repo **Settings → Secrets and variables → Actions**:
   - Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
     (the anon key is safe to build in — RLS protects everything)
   - Variables (optional): `VITE_CURRENCY`, `VITE_INACTIVITY_HOURS`
4. Push to `main` (or run the workflow manually). The app appears at
   `https://<user>.github.io/<repo>/`.
5. Point Supabase at it: Auth URLs (§2.4) + Edge Function secrets (§2.5).

Every later `git push` to `main` redeploys — installed PWAs pick the new
version up silently.

**How the GitHub Pages quirks are handled** (already done — nothing to do):
- *Base path*: the workflow auto-computes `/<repo>/` (or `/` for a
  `<user>.github.io` repo / custom domain) and Vite, the router, the manifest
  and the service worker all derive from it.
- *SPA deep links*: Pages has no rewrites, so the workflow publishes
  `404.html` as a copy of `index.html` — unknown paths load the app, which
  routes client-side (invite links to `/accept-invite` work).
- *Security headers*: Pages cannot send custom headers, so the CSP lives in
  a `<meta http-equiv>` tag in `index.html`. HTTPS is enforced by GitHub
  ("Enforce HTTPS" is on by default). `frame-ancestors` is not supported in
  meta CSP — acceptable for an internal tool.
- *Service-worker freshness*: browsers always revalidate `sw.js` on update
  checks regardless of Pages' ~10-minute cache, so auto-update still lands
  within about a minute of opening/focusing the app.

<details>
<summary>Alternative: Vercel / Netlify</summary>

`vercel.json` / `netlify.toml` are still included: import the repo, set the
same env vars, build `npm run build`, output `dist`. Those platforms also add
the full header-based CSP + HSTS on top of the meta tag.
</details>

## 5. How auto-update works (and staff install guide)

- The service worker (`vite-plugin-pwa`, `registerType: 'autoUpdate'`)
  precaches the app shell. On every launch, **every focus**, and every 60s,
  it checks the server for a new build; a new deploy is downloaded in the
  background and swapped in automatically. Nobody ever reinstalls anything.
- Supabase API calls are **never** cached by the service worker.

**Android (Chrome)**: open the site → menu ⋮ → **"Add to Home screen"** /
"Install app" → confirm. The 🥬 icon appears like a normal app.
**iPhone (Safari)**: open the site → Share □↑ → **"Add to Home Screen"**.
**Desktop (Chrome/Edge)**: install icon at the right of the address bar.

## 6. Security model

**Trust boundaries**

1. The browser is hostile. Every rule in the UI is re-enforced server-side:
   RLS policies (row access), Postgres CHECK constraints (value ranges),
   guard triggers (state machine + per-column rules per role).
2. The `anon` key is public by design — it grants nothing because every table
   is RLS **default-deny** and `anon` has zero policies.
3. The service-role key exists only in Edge Function secrets and the local
   seed script. It never ships to the client.
4. Roles/store assignment live **only** in the `profiles` table, readable via
   `SECURITY DEFINER` helpers (`get_my_role()`, `get_my_store_id()`), written
   only by the service role or superadmin/manager under trigger guards. No
   client-editable claims anywhere.

**PIN hardening** (a 6-digit PIN is weak on its own)

- Login only via the `auth-login` Edge Function: ≥5 failed attempts per
  email (or 20/IP) in 15 min → lockout. Attempts are logged in
  `login_attempts` (invisible to all clients).
- One generic "Invalid email or PIN" for every failure — no user enumeration.
- `is_active` is required by **every** RLS policy — deactivating a user cuts
  all access on their next request; the Edge Function also bans the auth user
  so token refresh dies too.
- Inactivity auto-logout (default 12 h, `VITE_INACTIVITY_HOURS`).
- PIN reset = superadmin/manager-triggered recovery email (re-invite flow).

**Driver price isolation** — drivers have *no RLS policy at all* on
`request_items`; their checklist reads the `driver_delivery_items` view,
which physically contains no price columns. This is structural, not cosmetic.

**Photos** — private bucket; drivers can write only under
`{delivery_id}/` for PENDING deliveries; reads only via 1-hour signed URLs.

**Audit** — SECURITY DEFINER triggers write `audit_log` on every
insert/update/delete of business tables (incl. old/new JSON); superadmin-only
read; immutable from clients.

**How to verify RLS** — see [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md)
§ "RLS verification" for copy-paste SQL that impersonates each role in the
SQL editor and proves: PIC cannot see other stores, driver cannot select any
price, anon sees nothing, deactivated users lose everything.

## 7. Free-tier limits & what to watch

| Resource | Free limit | This app | Watch when |
|---|---|---|---|
| Database | 500 MB | A cycle is a few KB; audit_log grows fastest | Prune `audit_log`/`login_attempts` older than ~1 year |
| Storage | 1 GB | ~150 KB/photo → ~4 photos/day ≈ 18 MB/month | Delete photos of cycles older than ~6 months |
| Monthly active users | 50 000 | A handful of staff | Never |
| Edge Function invocations | 500K/month | 2 functions, login-frequency traffic | Never |
| Realtime | 200 concurrent | One connection per open app | Never |
| **Project pausing** | Pauses after 7 days inactivity | Daily use prevents it | Holidays: just open the app once a week |
