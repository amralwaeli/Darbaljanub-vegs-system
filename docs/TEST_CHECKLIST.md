# Test Checklist — full order cycle + RLS verification

Seed first (`npm run seed`) so you have the five demo users
(see README §2.7 for logins). Use two browsers / phones side by side to see
realtime updates land.

---

## A. Manual test script (whole cycle, every role)

### 1. Manager — start the day
- [ ] Log in as `manager@demo.local` / `222222`.
- [ ] Home shows "No active order cycle" → tap **Start today's cycle** → confirm.
- [ ] Header badge shows **Open for requests**.

### 2. PIC — submit requests
- [ ] Log in as `pic-a@demo.local` / `333333` (second device/browser).
- [ ] **Request** tab → ➕ Add item → search "Tom" → Tomato → qty 10 kg → Add.
- [ ] Add Cucumber 5 kg, Potato 2 bag.
- [ ] Edit Tomato qty to 12 → blur → persists after refresh.
- [ ] Remove Potato → confirm dialog → gone.
- [ ] ➕ → **Request new item** → "Sweet Corn" → appears as *pending approval*
      on the manager's Admin → Items tab (not in the picker yet).
- [ ] Repeat as `pic-b@demo.local` / `444444`: Tomato 15 kg, Lettuce 3 box.
- [ ] **Realtime**: watch the manager dashboard — both requests appear
      without refreshing.

### 3. Manager — aggregate & WhatsApp
- [ ] Dashboard **Per store**: Store A and Store B cards with correct lines.
- [ ] **Aggregated**: Tomato = 27 kg with "Store A: 12 · Store B: 15".
- [ ] Tap **Lock & mark as Ordered** → confirm.
- [ ] As PIC A: request now read-only ("cycle is locked" banner); editing is
      also rejected server-side (see RLS section).
- [ ] **WhatsApp** tab → select Tomato + Cucumber → vendor "Abu Khalid
      Vegetables" → message preview shows `• Tomato — 27 kg` etc. →
      **Send via WhatsApp** → wa.me opens with the prefilled message; the
      order appears under sent orders with a re-open link.
- [ ] Send Lettuce to "Green Valley Farms" the same way.

### 4. Manager — cost entry
- [ ] **Purchase** tab → enter unit cost for every item (e.g. Tomato 2.50).
- [ ] Expand Tomato → adjust Store B purchased qty 15 → 14 → line total
      updates (14 × 2.50 = 35.00, computed by the DB).
- [ ] **Finish purchasing** button enables only when every item has a cost →
      tap → confirm. Badge becomes **Purchased — cost prices in**.

### 5. PIC — prices
- [ ] As PIC A, **Prices** tab: each line shows qty, unit cost, line total
      (**realtime** — appears without refresh if the tab was open).
- [ ] Type selling price 4.00 on Tomato → blur → "Price saved".
- [ ] Confirm PIC A **cannot** see Store B anywhere (no data of another store
      on any screen).

### 6. Driver — load with proof
- [ ] Log in as `driver@demo.local` / `555555`.
- [ ] Home lists Store A and Store B cards with addresses — **no prices
      anywhere**.
- [ ] Open Store A → tick items one by one — **Loaded** stays disabled.
- [ ] Tick all + take/attach photo → **Loaded** enables → tap → confirm.
- [ ] Store A card shows **Loaded**; manager's Deliveries tab shows the
      photo (signed URL) + timestamp.
- [ ] Load Store B → header badge flips to **Out for delivery**
      (auto-transition when the last store loads).
- [ ] Offline drill: airplane mode → tick a checkbox → banner "You are
      offline" → back online → tick syncs (verify in manager view).

### 7. PIC — receive
- [ ] As PIC A, Prices tab → delivery card shows **Loaded** + photo →
      **Confirm goods received** → status **Received**.
- [ ] After PIC B confirms too, the cycle badge becomes **Completed** —
      manager home offers to start a new cycle.

### 8. Admin & security UX
- [ ] Manager → Admin → Items: approve "Sweet Corn" → PIC picker now has it.
- [ ] Admin → Stores: add "Store C", edit address, assign PIC.
- [ ] Admin → Vendors: add vendor; bad WhatsApp number (letters) is rejected.
- [ ] Admin → Users: invite a real email as PIC + store → email arrives →
      link opens **accept-invite** → set name + PIN → login works with new PIN.
- [ ] Deactivate the driver → driver's next action fails / screens empty;
      reactivate → works again.
- [ ] Reset PIN for a user → recovery email → set new PIN → old PIN dead.
- [ ] Login lockout: 5 wrong PINs → "Too many attempts. Try again in 15
      minutes." (same message whether or not the email exists).
- [ ] As superadmin: Admin → **Audit** shows the unit_cost changes, status
      changes and user changes from this test, with before/after JSON.
- [ ] PWA: install on a phone (Add to Home Screen) → deploy any tiny change
      → reopen/refocus the app → new version arrives within ~a minute,
      no reinstall.

---

## B. RLS verification (SQL editor)

Run in the Supabase SQL editor. Get the demo user ids first:

```sql
select u.id, u.email, p.role from auth.users u join public.profiles p on p.id = u.id;
```

The pattern below impersonates a role for one transaction, then rolls back.
Replace `<uuid>` with the id of the user named in each block.

### 1. Anonymous sees nothing
```sql
begin;
set local role anon;
select count(*) from public.request_items;   -- ERROR: permission denied
rollback;
```

### 2. Driver can NEVER read prices
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<driver-uuid>', 'role', 'authenticated')::text, true);

select count(*) from public.request_items;        -- 0 rows (no policy for drivers)
select count(*) from public.vendors;              -- 0 rows
select * from public.driver_delivery_items limit 5;
-- ^ rows appear, and the view HAS NO price columns to select.
rollback;
```

### 3. PIC A cannot see Store B
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<pic-a-uuid>', 'role', 'authenticated')::text, true);

select distinct store_id from public.store_requests;  -- ONLY Store A's id
select count(*) from public.vendors;                  -- 0 (vendors are manager-only)
select count(*) from public.audit_log;                -- 0 (superadmin-only)

-- PIC cannot write cost fields even on their own rows (guard trigger):
update public.request_items set unit_cost = 1
 where id = (select id from public.request_items limit 1);
-- ERROR: PIC cannot modify cost fields
rollback;
```

### 4. Locked cycle rejects PIC edits
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<pic-a-uuid>', 'role', 'authenticated')::text, true);
-- with the cycle in ORDERED or later:
update public.request_items set requested_qty = 99
 where id = (select id from public.request_items limit 1);
-- ERROR: Cycle is locked — request can no longer be edited
rollback;
```

### 5. Manager cannot touch selling prices or superadmins
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<manager-uuid>', 'role', 'authenticated')::text, true);

update public.request_items set selling_price = 9
 where id = (select id from public.request_items limit 1);
-- ERROR: Manager cannot set selling prices

update public.profiles set is_active = false where role = 'superadmin';
-- 0 rows updated (RLS) / ERROR from guard trigger
rollback;
```

### 6. "Loaded" is impossible without photo + full checklist
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<driver-uuid>', 'role', 'authenticated')::text, true);
update public.deliveries set status = 'LOADED'
 where status = 'PENDING' limit 1;  -- adapt to: where id = '<delivery-uuid>'
-- ERROR: A loading photo is required before marking as loaded
--    (or: All items must be checked before marking as loaded)
rollback;
```

### 7. Deactivation kills access instantly
```sql
update public.profiles set is_active = false where id = '<driver-uuid>';

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<driver-uuid>', 'role', 'authenticated')::text, true);
select count(*) from public.deliveries;   -- 0 rows — everything is gone
rollback;

update public.profiles set is_active = true where id = '<driver-uuid>';
```

### 8. Audit log is superadmin-only and immutable
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<superadmin-uuid>', 'role', 'authenticated')::text, true);
select count(*) from public.audit_log;              -- rows visible
delete from public.audit_log where id = 1;          -- ERROR: permission denied
rollback;
```
