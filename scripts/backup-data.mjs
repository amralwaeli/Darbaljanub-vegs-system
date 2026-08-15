// ============================================================================
// Data backup — run LOCALLY ONLY (needs the service-role key):
//
//   node scripts/backup-data.mjs
//
// WHY THIS EXISTS: the Supabase free tier has no automatic backups, no PITR,
// and no download button. pg_dump is not installed on this machine and the
// CLI is authenticated to a different account, so the usual route is closed.
//
// WHAT THIS IS: the SCHEMA already lives in git (supabase/migrations/*.sql).
// This script captures the other half — the DATA — as one JSON file per table.
// Migrations + these files together are a restorable snapshot.
//
// WHAT THIS IS NOT: it does not capture functions, triggers, policies, roles,
// sequences, or auth.users (passwords/PIN hashes live in the auth schema and
// are not reachable through PostgREST). Re-running the migrations rebuilds the
// former; users must be re-invited or re-seeded. See restore-data.mjs.
//
// Output: backups/<UTC date>/<table>.json  (+ manifest.json)
// backups/ is gitignored — these files contain PII (names, emails, IPs).
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Minimal .env loader (avoids a dotenv dependency)
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY first.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  // Supabase rejects secret keys on requests that look browser-originated.
  global: { headers: { "User-Agent": "vegs-backup-script" } },
});

// Ordered parents-first so a restore can replay them without FK violations.
const TABLES = [
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

// app_config holds the push webhook secret. Keys are captured so a restore
// knows what to set; VALUES are never written to disk.
const REDACTED_TABLES = { app_config: ["value"] };

const PAGE = 1000; // keep each request small — shared CPU, 5 GB egress budget

async function dumpTable(name) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(name)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const redact = REDACTED_TABLES[name];
  if (redact) {
    for (const row of rows) {
      for (const col of redact) row[col] = "__REDACTED__";
    }
  }
  return rows;
}

const stamp = new Date().toISOString().slice(0, 10);
const dir = join("backups", stamp);
mkdirSync(dir, { recursive: true });

const manifest = { takenAt: new Date().toISOString(), project: url, tables: {} };
let total = 0;
let failed = 0;

for (const name of [...TABLES, ...Object.keys(REDACTED_TABLES)]) {
  try {
    const rows = await dumpTable(name);
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
    manifest.tables[name] = rows.length;
    total += rows.length;
    console.log(`  ${name.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
  } catch (e) {
    failed++;
    manifest.tables[name] = `ERROR: ${e.message}`;
    console.error(`  ${name.padEnd(22)} FAILED: ${e.message}`);
  }
}

manifest.totalRows = total;
manifest.note =
  "Schema is NOT in here — it lives in supabase/migrations/. auth.users " +
  "(logins/PINs) is not reachable via PostgREST and is NOT backed up.";
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`\n${total} rows -> ${dir}${failed ? `  (${failed} table(s) failed)` : ""}`);
process.exit(failed ? 1 : 0);
