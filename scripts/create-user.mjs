// ============================================================================
// Admin utility: create (or update) a user directly, bypassing the invite
// email flow. Runs LOCALLY with the service-role key from .env.
//
//   node scripts/create-user.mjs <email> <pin6> <role> [username]
//   e.g. node scripts/create-user.mjs boss@example.com 123456 superadmin "Boss"
//
// Roles: superadmin | manager | pic | driver
// (For PICs prefer the in-app invite flow, which also assigns the store.)
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const [email, pin, role, username] = process.argv.slice(2);
const VALID_ROLES = ["superadmin", "manager", "pic", "driver"];

if (!email || !/^\d{6}$/.test(pin ?? "") || !VALID_ROLES.includes(role ?? "")) {
  console.error(
    "Usage: node scripts/create-user.mjs <email> <pin6> <superadmin|manager|pic|driver> [username]",
  );
  process.exit(1);
}

const admin = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: created, error } = await admin.auth.admin.createUser({
  email: email.toLowerCase(),
  password: pin,
  email_confirm: true,
});

let userId = created?.user?.id;
if (error) {
  if (!/already/i.test(error.message)) throw error;
  const { data: list } = await admin.auth.admin.listUsers();
  userId = list?.users.find((u) => u.email === email.toLowerCase())?.id;
  if (!userId) throw error;
  await admin.auth.admin.updateUserById(userId, { password: pin });
  console.log("= user existed; PIN updated");
} else {
  console.log("+ auth user created");
}

const { error: profileError } = await admin.from("profiles").upsert({
  id: userId,
  username: username ?? email.split("@")[0],
  role,
  is_active: true,
});
if (profileError) throw profileError;

const { data: check } = await admin
  .from("profiles")
  .select("username, role, is_active")
  .eq("id", userId)
  .single();
console.log("profile:", check);
console.log(`\nDone: ${email} / PIN ${pin} -> ${role}`);
