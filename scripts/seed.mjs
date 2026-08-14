// ============================================================================
// Demo user seed — run LOCALLY ONLY (needs the service-role key):
//
//   1. Run migrations 0001..0007 in the Supabase SQL editor first.
//   2. set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or put them in .env)
//   3. node scripts/seed.mjs
//
// Creates: 1 superadmin, 1 manager, 2 store PICs, 1 driver — all with PIN
// logins — and wires the PICs to the two seeded stores.
//
// ⚠ Demo PINs below are for local/testing only. Change them (or delete the
//   demo users) before real use.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

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
});

const DEMO_USERS = [
  { email: "admin@demo.local",   pin: "111111", username: "Super Admin", role: "superadmin", store: null },
  { email: "manager@demo.local", pin: "222222", username: "Main Manager", role: "manager",   store: null },
  { email: "pic-a@demo.local",   pin: "333333", username: "PIC Store A",  role: "pic",       store: "Store A — Main Street" },
  { email: "pic-b@demo.local",   pin: "444444", username: "PIC Store B",  role: "pic",       store: "Store B — South Market" },
  { email: "driver@demo.local",  pin: "555555", username: "Driver Ali",   role: "driver",    store: null },
];

async function main() {
  const { data: stores, error: storesError } = await admin
    .from("stores")
    .select("id, name");
  if (storesError) throw storesError;
  if (!stores?.length) {
    throw new Error("No stores found — run migration 0007_seed.sql first.");
  }

  for (const user of DEMO_USERS) {
    // Create the auth user with PIN-as-password, already confirmed.
    const { data: created, error } = await admin.auth.admin.createUser({
      email: user.email,
      password: user.pin,
      email_confirm: true,
    });

    let userId = created?.user?.id;
    if (error) {
      if (!/already/i.test(error.message)) throw error;
      // Already seeded — look the user up instead.
      const { data: list } = await admin.auth.admin.listUsers();
      userId = list?.users.find((u) => u.email === user.email)?.id;
      if (!userId) throw error;
      console.log(`= exists: ${user.email}`);
    } else {
      console.log(`+ created: ${user.email} (PIN ${user.pin})`);
    }

    const storeId = user.store
      ? (stores.find((s) => s.name === user.store)?.id ?? null)
      : null;

    const { error: profileError } = await admin.from("profiles").upsert({
      id: userId,
      username: user.username,
      role: user.role,
      store_id: storeId,
      is_active: true,
    });
    if (profileError) throw profileError;

    if (user.role === "pic" && storeId) {
      const { error: picError } = await admin
        .from("stores")
        .update({ pic_id: userId })
        .eq("id", storeId);
      if (picError) throw picError;
    }
  }

  console.log("\nDone. Demo logins (email / PIN):");
  for (const u of DEMO_USERS) console.log(`  ${u.email} / ${u.pin}`);
}

main().catch((e) => {
  console.error("Seed failed:", e.message ?? e);
  process.exit(1);
});
