# Architecture — Multi-Store Vegetable Procurement & Distribution PWA

## 1. System components

```
┌─────────────────────────────  Devices (phones / desktop)  ─────────────────────────────┐
│                                                                                        │
│   Installed PWA (React + Vite + TS + Tailwind)                                         │
│   ├─ Service Worker (vite-plugin-pwa, registerType: autoUpdate)                        │
│   │    • precaches app shell   • checks for updates on launch/focus + every 60s        │
│   │    • applies new versions silently — users never reinstall                         │
│   ├─ TanStack Query (cache, retries for flaky market networks, optimistic checklists) │
│   ├─ Offline queue (localStorage) for driver ticks + photo uploads                     │
│   └─ supabase-js v2 client (anon key only)                                             │
│                                                                                        │
└───────────────┬───────────────────────────────┬────────────────────────────────────────┘
                │ HTTPS (PostgREST / Realtime /  │  HTTPS
                │ Storage, all behind RLS)       │  (Edge Functions)
┌───────────────▼───────────────────────────────▼────────────────────────────────────────┐
│                              SUPABASE (free tier)                                      │
│                                                                                        │
│  Postgres                        Auth                     Edge Functions (Deno)        │
│  ├─ schema (11 tables)           ├─ email+password        ├─ invite-user  (JWT req.)   │
│  ├─ RLS on EVERY table           │  (password = 6-digit   │    • role check in DB      │
│  ├─ SECURITY DEFINER helpers     │   PIN, hardened)       │    • inviteUserByEmail     │
│  │  get_my_role()/store_id()     ├─ invite / recovery     │    • creates profile row   │
│  ├─ guard triggers (state        │  links (built-in mail) ├─ auth-login  (public)      │
│  │  machine + column rules)      └─ JWT → auth.uid()      │    • rate limit / lockout  │
│  ├─ audit triggers → audit_log                            │    • proxies password      │
│  └─ driver-safe VIEW (no price                            │      grant, generic errors │
│     columns reachable)                                    └─ (service-role key lives   │
│                                                               ONLY here)               │
│  Storage: private bucket `delivery-photos` — signed URLs only, path-scoped policies    │
│  Realtime: postgres_changes on cycles/requests/items/deliveries (RLS-filtered)         │
└────────────────────────────────────────────────────────────────────────────────────────┘
                │
                ▼
  WhatsApp — plain `https://wa.me/<number>?text=<encoded>` deep links (no API, free)

  Hosting: Vercel/Netlify free tier — static files + CSP headers (vercel.json /
  netlify.toml / public/_headers). New deploy → SW picks it up → silent auto-update.
```

## 2. Order-cycle state machine

An OPEN cycle **always exists** (migration 0009): stores can file a request at
any hour without waiting for a manager to start one. Locking it immediately
creates its replacement, so the order being purchased and the next round of
requests run side by side. Two partial unique indexes hold the invariant: at
most one OPEN cycle, and at most one in-flight (ORDERED/PURCHASED/IN_DELIVERY)
cycle.

```
                   Always present; auto-created
                           │
                           ▼
                       ┌──────┐   PICs create/edit their store request
                       │ OPEN │   (request_items: item, qty, unit)
                       └──┬───┘   ← PIC edits allowed ONLY here (DB trigger enforced)
    Manager locks &       │       first item filed → push to managers
    generates vendor      │       leaving OPEN → a fresh OPEN cycle is created
    WhatsApp orders       ▼
                      ┌─────────┐  vendor_orders + message snapshots saved
                      │ ORDERED │  wa.me deep links opened per vendor
                      └──┬──────┘
    Manager enters        │
    unit_cost +           ▼
    purchased_qty     ┌───────────┐  trigger auto-creates one delivery per store
                      │ PURCHASED │  + delivery_item_checks rows
                      └──┬────────┘  PIC now sees cost & sets selling_price
    every store           │
    delivery LOADED       ▼
    (auto, trigger)   ┌─────────────┐  driver: tick all items + photo → "Loaded"
                      │ IN_DELIVERY │  (button server-validated: trigger rejects
                      └──┬──────────┘   LOADED without photo + all ticks)
    every delivery        │
    RECEIVED (auto)       ▼
                      ┌───────────┐
                      │ COMPLETED │
                      └───────────┘

  Per-store delivery sub-machine:  PENDING ──(driver: photo + all ticks)──▶ LOADED
                                   LOADED ──(driver: offload photo)──────▶ OFFLOADED
                                   OFFLOADED ──(PIC confirms receipt)────▶ RECEIVED

  Two photos, two parties: the driver proves what left the market AND what was
  handed over at the shop; the shop separately confirms it received it. Both
  photos are required by deliveries_guard, not by the UI.

  All transitions validated by BEFORE UPDATE triggers — invalid jumps raise
  exceptions regardless of what any client sends. SuperAdmin may override.
```

## 3. Data flow per role

| Role | Reads | Writes |
|---|---|---|
| PIC | own store request + items (incl. cost after PURCHASED), own store delivery (photo/status), cycle status, item catalog | own request_items while OPEN; selling_price after PURCHASED; delivery → RECEIVED; propose catalog items (unapproved) |
| Manager | everything except: cannot see other-store selling flows it doesn't own — actually full read of requests/costs; users list | cycle create/lock/status, vendor orders, unit_cost/purchased_qty, stores/items/vendors CRUD, invite users, deactivate pic/driver |
| Driver | deliveries + checklist via price-free `driver_delivery_items` VIEW (item name, qty, unit only), store names/addresses | tick checks, upload photo (own delivery path only), delivery → LOADED |
| SuperAdmin | everything incl. audit_log | everything |

Price isolation for drivers is **structural**: RLS grants drivers zero rows on
`request_items`; their checklist data comes from a `security_barrier` view owned by
`postgres` that simply has no price columns.

## 4. Trust boundaries

1. **Browser = hostile.** UI role checks are convenience only. Every rule is re-enforced by RLS + Postgres CHECK constraints + guard triggers.
2. **Anon key = public.** Safe because RLS is default-deny on all tables.
3. **Service-role key** exists only inside Edge Functions (Supabase secrets) and the local seed script. Never shipped to the client.
4. **Role/store assignment** lives only in `profiles`, written only by Edge Functions (service role) or SuperAdmin/Manager under RLS + trigger guards. Never in client-editable JWT claims.
5. **PIN weakness compensated** by: Edge-Function login proxy with per-email+IP lockout (5 fails / 15 min), generic error messages (no user enumeration), `is_active` checked in every RLS policy (instant kill switch), inactivity auto-logout (default 12h), SuperAdmin-triggered PIN reset via recovery link.

## 5. Key implementation decisions

- **Deliveries + checklist rows are created by a DB trigger** on `PURCHASED` — no client orchestration to trust.
- **`line_total` is a Postgres generated column** (`coalesce(purchased_qty, requested_qty) * unit_cost`) — never computed client-side.
- **Audit** is trigger-based (`record_audit()`, SECURITY DEFINER) on all business tables; SuperAdmin-only read.
- **Realtime**: manager subscribes to `store_requests`/`request_items` (new PIC submissions appear live); PIC subscribes to own `request_items` (costs appear live) and `deliveries`; driver subscribes to `deliveries`. RLS filters realtime payloads server-side.
- **Photo pipeline**: canvas resize ≤1280px, JPEG q0.7 (~100–200 KB) → private bucket path `{delivery_id}/{timestamp}.jpg` → read via 1-hour signed URLs.
- **Free-tier discipline**: photos ~150 KB × ~4 stores/day ≈ 18 MB/month → ~4.5 years of headroom in 1 GB; DB rows are tiny; Edge Functions used only for login + invites.
