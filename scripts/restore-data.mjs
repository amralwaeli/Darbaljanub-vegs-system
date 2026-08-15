// ============================================================================
// Data restore — run LOCALLY ONLY (needs the service-role key):
//
//   node scripts/restore-data.mjs backups/2026-08-15
//
// PREREQUISITE: the schema must already exist. Run every migration in
// supabase/migrations/ (in filename order) against the target project FIRST.
// This script only replays rows.
//
// It upserts on primary key, parents before children, so it is safe to re-run
// and safe against a partially-populated database. It never deletes anything —
// restoring into a dirty database merges rather than replaces.
//
// NOT RESTORED, by design:
//   * auth.users — logins and PIN hashes live in the auth schema, which
//     PostgREST does not expose. Re-invite users, or re-run scripts/seed.mjs
//     for demo accounts. profiles rows restore fine but have no login behind
//     them until the auth user exists with a MATCHING id.
//   * app_config values — the push webhook secret was redacted at backup time.
//     Re-set it from the Edge Function secrets (see README §5b).
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dir = process.argv[2];

if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
if (!dir || !existsSync(dir)) {
  const available = existsSync("backups") ? readdirSync("backups").join(", ") : "none";
  console.error(`Usage: node scripts/restore-data.mjs <backup-dir>\nAvailable: ${available}`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "User-Agent": "vegs-restore-script" } },
});

// Parents first — children carry FKs that must already resolve.
const ORDER = [
  "stores",
  "profiles",
  "items",
  "vendors",
  "order_cycles",
  "store_requests",
  "request_items",
  "vendor_orders",
  "vendor_order_items",
  "deliveries",
  "delivery_item_checks",
  "push_subscriptions",
  "audit_log",
  "login_attempts",
];

// audit_log.id is a generated identity column; sending it back would collide
// with the sequence. Dropped so Postgres reissues ids.
const DROP_COLUMNS = { audit_log: ["id"] };

const CHUNK = 200;
let restored = 0;
let failed = 0;

for (const table of ORDER) {
  const file = join(dir, `${table}.json`);
  if (!existsSync(file)) {
    console.log(`  ${table.padEnd(22)} (no file, skipped)`);
    continue;
  }

  const rows = JSON.parse(readFileSync(file, "utf8"));
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(22)}      0 rows`);
    continue;
  }

  const drop = DROP_COLUMNS[table];
  const payload = drop
    ? rows.map((r) => {
        const copy = { ...r };
        for (const c of drop) delete copy[c];
        return copy;
      })
    : rows;

  let ok = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = drop
      ? await admin.from(table).insert(slice)
      : await admin.from(table).upsert(slice);
    if (error) {
      failed++;
      console.error(`  ${table.padEnd(22)} FAILED at row ${i}: ${error.message}`);
      break;
    }
    ok += slice.length;
  }
  restored += ok;
  console.log(`  ${table.padEnd(22)} ${String(ok).padStart(6)} rows`);
}

console.log(`\n${restored} rows restored${failed ? `  (${failed} table(s) failed)` : ""}`);
console.log(
  "Remember: auth users and app_config values are NOT restored — see the header.",
);
process.exit(failed ? 1 : 0);
