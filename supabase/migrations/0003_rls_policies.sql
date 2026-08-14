-- ============================================================================
-- 0003_rls_policies.sql — Row Level Security: default deny, explicit per-role
-- policies matching the permission matrix exactly.
--
-- Rules of thumb used throughout:
--   * RLS is ENABLED on every table. No policy => no access (default deny).
--   * Every policy requires public.is_active_user() — deactivating a user in
--     `profiles` cuts off ALL access on their very next request.
--   * Roles come from public.get_my_role() (SECURITY DEFINER, reads profiles)
--     — never from client-supplied claims.
--   * `anon` gets nothing: all policies target the `authenticated` role.
-- ============================================================================

alter table public.profiles             enable row level security;
alter table public.stores               enable row level security;
alter table public.items                enable row level security;
alter table public.vendors              enable row level security;
alter table public.order_cycles         enable row level security;
alter table public.store_requests       enable row level security;
alter table public.request_items        enable row level security;
alter table public.vendor_orders        enable row level security;
alter table public.vendor_order_items   enable row level security;
alter table public.deliveries           enable row level security;
alter table public.delivery_item_checks enable row level security;
alter table public.audit_log            enable row level security;
alter table public.login_attempts       enable row level security;

-- Belt & braces: anon (logged-out) can see nothing at all.
revoke all on all tables in schema public from anon;

-- ============================================================== profiles ==
-- Everyone may read their OWN profile even if deactivated (so the app can
-- show "your account is disabled" instead of a confusing auth loop).
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Manager & superadmin see all users (users admin screen).
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

-- Users may update their own row (trigger profiles_guard limits columns).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid());

-- Manager may manage non-superadmin users (deactivate PICs/drivers, assign
-- stores). profiles_guard blocks any superadmin involvement.
create policy profiles_update_manager on public.profiles
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() = 'manager' and role <> 'superadmin')
  with check (role <> 'superadmin');

-- Superadmin: full control.
create policy profiles_all_superadmin on public.profiles
  for all to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin')
  with check (public.get_my_role() = 'superadmin');

-- ================================================================ stores ==
-- PIC sees only their own store; driver sees all active stores (needs names
-- + addresses for deliveries); manager/superadmin see all.
create policy stores_select on public.stores
  for select to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('manager', 'superadmin')
      or (public.get_my_role() = 'pic'    and id = public.get_my_store_id())
      or (public.get_my_role() = 'driver' and is_active)
    )
  );

create policy stores_write_admin on public.stores
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy stores_update_admin on public.stores
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'))
  with check (public.get_my_role() in ('manager', 'superadmin'));

create policy stores_delete_superadmin on public.stores
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- ================================================================= items ==
-- Catalog is readable by every active user (drivers need item names too).
create policy items_select on public.items
  for select to authenticated
  using (public.is_active_user());

-- PIC may PROPOSE a new item: it arrives unapproved, attributed to them.
create policy items_insert_pic on public.items
  for insert to authenticated
  with check (
    public.is_active_user() and public.get_my_role() = 'pic'
    and is_approved = false and created_by = auth.uid()
  );

create policy items_insert_admin on public.items
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy items_update_admin on public.items
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'))
  with check (public.get_my_role() in ('manager', 'superadmin'));

create policy items_delete_superadmin on public.items
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- =============================================================== vendors ==
-- Vendors (and their WhatsApp numbers) are manager/superadmin business only.
-- Delete stays superadmin-only ("delete anything" is a superadmin power).
create policy vendors_select_admin on public.vendors
  for select to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy vendors_insert_admin on public.vendors
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy vendors_update_admin on public.vendors
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'))
  with check (public.get_my_role() in ('manager', 'superadmin'));

create policy vendors_delete_superadmin on public.vendors
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- ========================================================== order_cycles ==
-- Cycle status drives every screen, and contains nothing sensitive:
-- all active users may read it.
create policy cycles_select on public.order_cycles
  for select to authenticated
  using (public.is_active_user());

create policy cycles_insert_admin on public.order_cycles
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

-- Status transitions validated by order_cycle_guard trigger.
create policy cycles_update_admin on public.order_cycles
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'))
  with check (public.get_my_role() in ('manager', 'superadmin'));

create policy cycles_delete_superadmin on public.order_cycles
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- ======================================================== store_requests ==
-- PIC: own store only. Manager/superadmin: all. Driver: none (they use
-- deliveries + the price-free view instead).
create policy store_requests_select on public.store_requests
  for select to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('manager', 'superadmin')
      or (public.get_my_role() = 'pic' and store_id = public.get_my_store_id())
    )
  );

create policy store_requests_insert_pic on public.store_requests
  for insert to authenticated
  with check (
    public.is_active_user()
    and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'pic'
        and store_id = public.get_my_store_id()
        and created_by = auth.uid()
        -- only into a cycle that is still OPEN
        and exists (select 1 from public.order_cycles oc
                    where oc.id = cycle_id and oc.status = 'OPEN')
      )
    )
  );

create policy store_requests_update on public.store_requests
  for update to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'pic'
        and store_id = public.get_my_store_id()
        and exists (select 1 from public.order_cycles oc
                    where oc.id = cycle_id and oc.status = 'OPEN')
      )
    )
  )
  with check (store_id = public.get_my_store_id() or public.get_my_role() = 'superadmin');

create policy store_requests_delete on public.store_requests
  for delete to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'pic'
        and store_id = public.get_my_store_id()
        and exists (select 1 from public.order_cycles oc
                    where oc.id = cycle_id and oc.status = 'OPEN')
      )
    )
  );

-- ========================================================= request_items ==
-- THE price table. Drivers have NO policy here at all: they physically cannot
-- select any row (price isolation is structural, not cosmetic). Their
-- checklist data comes from the driver_delivery_items view (0004).
create policy request_items_select on public.request_items
  for select to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('manager', 'superadmin')
      or (
        public.get_my_role() = 'pic'
        and exists (select 1 from public.store_requests sr
                    where sr.id = store_request_id
                      and sr.store_id = public.get_my_store_id())
      )
    )
  );

-- Inserts: PIC into own store's request only (request_items_guard trigger
-- additionally enforces OPEN cycle + null purchase fields).
create policy request_items_insert on public.request_items
  for insert to authenticated
  with check (
    public.is_active_user() and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'pic'
        and exists (select 1 from public.store_requests sr
                    where sr.id = store_request_id
                      and sr.store_id = public.get_my_store_id())
      )
    )
  );

-- Updates: PIC (own store) and manager — column/state rules live in the
-- request_items_guard trigger.
create policy request_items_update on public.request_items
  for update to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('manager', 'superadmin')
      or (
        public.get_my_role() = 'pic'
        and exists (select 1 from public.store_requests sr
                    where sr.id = store_request_id
                      and sr.store_id = public.get_my_store_id())
      )
    )
  )
  with check (true);  -- row targeting handled by USING; columns by trigger

create policy request_items_delete on public.request_items
  for delete to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'pic'
        and exists (
          select 1
          from public.store_requests sr
          join public.order_cycles oc on oc.id = sr.cycle_id
          where sr.id = store_request_id
            and sr.store_id = public.get_my_store_id()
            and oc.status = 'OPEN'
        )
      )
    )
  );

-- ==================================== vendor_orders / vendor_order_items ==
-- Manager: read + record orders. Delete: superadmin only.
create policy vendor_orders_select_admin on public.vendor_orders
  for select to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy vendor_orders_insert_admin on public.vendor_orders
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy vendor_orders_update_admin on public.vendor_orders
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'))
  with check (public.get_my_role() in ('manager', 'superadmin'));

create policy vendor_orders_delete_superadmin on public.vendor_orders
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

create policy vendor_order_items_select_admin on public.vendor_order_items
  for select to authenticated
  using (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy vendor_order_items_insert_admin on public.vendor_order_items
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() in ('manager', 'superadmin'));

create policy vendor_order_items_delete_superadmin on public.vendor_order_items
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- ============================================================ deliveries ==
-- Contains NO price data, so drivers may read it directly.
-- PIC sees own store's delivery (photo, status, timestamps).
create policy deliveries_select on public.deliveries
  for select to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('driver', 'manager', 'superadmin')
      or (public.get_my_role() = 'pic' and store_id = public.get_my_store_id())
    )
  );

-- Rows are inserted by the PURCHASED trigger (definer) or superadmin.
create policy deliveries_insert_superadmin on public.deliveries
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() = 'superadmin');

-- Driver: PENDING -> LOADED. PIC/manager: LOADED -> RECEIVED.
-- deliveries_guard trigger validates the transition, photo and checklist.
create policy deliveries_update on public.deliveries
  for update to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('driver', 'manager', 'superadmin')
      or (public.get_my_role() = 'pic' and store_id = public.get_my_store_id())
    )
  )
  with check (true);  -- transition legality enforced by trigger

create policy deliveries_delete_superadmin on public.deliveries
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- ================================================== delivery_item_checks ==
-- Checklist rows carry NO prices (just delivery_id/request_item_id/checked).
create policy dic_select on public.delivery_item_checks
  for select to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() in ('driver', 'manager', 'superadmin')
      or (
        public.get_my_role() = 'pic'
        and exists (select 1 from public.deliveries d
                    where d.id = delivery_id
                      and d.store_id = public.get_my_store_id())
      )
    )
  );

create policy dic_insert_superadmin on public.delivery_item_checks
  for insert to authenticated
  with check (public.is_active_user() and public.get_my_role() = 'superadmin');

-- Drivers tick/untick while PENDING (delivery_checks_guard freezes after).
create policy dic_update on public.delivery_item_checks
  for update to authenticated
  using (public.is_active_user() and public.get_my_role() in ('driver', 'superadmin'))
  with check (true);

create policy dic_delete_superadmin on public.delivery_item_checks
  for delete to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- ============================================================= audit_log ==
-- Written exclusively by the SECURITY DEFINER trigger. Read: superadmin only.
create policy audit_select_superadmin on public.audit_log
  for select to authenticated
  using (public.is_active_user() and public.get_my_role() = 'superadmin');

-- No insert/update/delete policies: immutable from all clients.
revoke insert, update, delete on public.audit_log from authenticated;

-- ======================================================== login_attempts ==
-- No policies at all: only the service role (Edge Function) touches it.
revoke all on public.login_attempts from authenticated;
