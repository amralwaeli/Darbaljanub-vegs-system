-- ============================================================================
-- 0002_functions_triggers.sql — helper functions, guard triggers, audit trail
-- ============================================================================

-- ------------------------------------------------- RLS helper functions ----
-- SECURITY DEFINER so they can read `profiles` without triggering recursive
-- RLS evaluation. STABLE so Postgres caches the result within a statement.
-- `set search_path` pins the schema (definer-function hardening).

create or replace function public.get_my_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.get_my_store_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select store_id from public.profiles where id = auth.uid();
$$;

-- Deactivated users lose ALL access instantly: every RLS policy requires this.
create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.get_my_role()     to authenticated;
grant execute on function public.get_my_store_id() to authenticated;
grant execute on function public.is_active_user()  to authenticated;

-- ---------------------------------------------------- updated_at helper ----
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger t_upd_profiles       before update on public.profiles       for each row execute function public.set_updated_at();
create trigger t_upd_stores         before update on public.stores         for each row execute function public.set_updated_at();
create trigger t_upd_items          before update on public.items          for each row execute function public.set_updated_at();
create trigger t_upd_vendors        before update on public.vendors        for each row execute function public.set_updated_at();
create trigger t_upd_order_cycles   before update on public.order_cycles   for each row execute function public.set_updated_at();
create trigger t_upd_store_requests before update on public.store_requests for each row execute function public.set_updated_at();
create trigger t_upd_request_items  before update on public.request_items  for each row execute function public.set_updated_at();
create trigger t_upd_deliveries     before update on public.deliveries     for each row execute function public.set_updated_at();
create trigger t_upd_dic            before update on public.delivery_item_checks for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ audit log ----
-- SECURITY DEFINER: clients have no INSERT grant on audit_log; only this
-- trigger function can write it.
create or replace function public.record_audit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(case when tg_op = 'DELETE' then old.id::text else new.id::text end, '?'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger t_audit_profiles       after insert or update or delete on public.profiles       for each row execute function public.record_audit();
create trigger t_audit_stores         after insert or update or delete on public.stores         for each row execute function public.record_audit();
create trigger t_audit_items          after insert or update or delete on public.items          for each row execute function public.record_audit();
create trigger t_audit_vendors        after insert or update or delete on public.vendors        for each row execute function public.record_audit();
create trigger t_audit_order_cycles   after insert or update or delete on public.order_cycles   for each row execute function public.record_audit();
create trigger t_audit_store_requests after insert or update or delete on public.store_requests for each row execute function public.record_audit();
create trigger t_audit_request_items  after insert or update or delete on public.request_items  for each row execute function public.record_audit();
create trigger t_audit_deliveries     after insert or update or delete on public.deliveries     for each row execute function public.record_audit();

-- --------------------------------------------- profiles column guard ----
-- RLS decides WHICH rows can be updated; this trigger decides WHICH COLUMNS.
-- Prevents privilege escalation (a PIC making themselves manager, a manager
-- touching a superadmin, anyone reactivating themselves).
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.get_my_role();
begin
  -- service role (auth.uid() is null) and superadmin: unrestricted
  if r is null or r = 'superadmin' then
    return new;
  end if;

  if r = 'manager' then
    -- managers may never touch superadmin accounts or mint superadmins
    if old.role = 'superadmin' or new.role = 'superadmin' then
      raise exception 'Managers cannot modify superadmin accounts';
    end if;
    return new;
  end if;

  -- pic / driver: may only edit their own username & phone
  if new.role      is distinct from old.role
    or new.store_id  is distinct from old.store_id
    or new.is_active is distinct from old.is_active then
    raise exception 'You cannot change role, store or active status';
  end if;
  return new;
end $$;

create trigger t_guard_profiles before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------- order cycle state guard ----
-- Enforces the state machine server-side: OPEN → ORDERED → PURCHASED →
-- IN_DELIVERY → COMPLETED. Superadmin (and service role) may override.
create or replace function public.order_cycle_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.get_my_role();
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'OPEN'        and new.status = 'ORDERED')
      or (old.status = 'ORDERED'     and new.status = 'PURCHASED')
      or (old.status = 'PURCHASED'   and new.status = 'IN_DELIVERY')
      or (old.status = 'IN_DELIVERY' and new.status = 'COMPLETED')
      or r = 'superadmin' or r is null
    ) then
      raise exception 'Invalid cycle transition: % -> %', old.status, new.status;
    end if;
    if old.status = 'OPEN' then
      new.locked_at := now();   -- lock timestamp when PIC editing closes
    end if;
  end if;
  return new;
end $$;

create trigger t_guard_order_cycles before update on public.order_cycles
  for each row execute function public.order_cycle_guard();

-- ------------------------------- auto-create deliveries on PURCHASED ----
-- When the manager marks the cycle PURCHASED, the DB (not the client) creates
-- one delivery per store that requested items, plus its checklist rows.
create or replace function public.create_deliveries_for_cycle()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status = 'PURCHASED' and old.status is distinct from new.status then
    insert into public.deliveries (cycle_id, store_id)
    select new.id, sr.store_id
    from public.store_requests sr
    where sr.cycle_id = new.id
      and exists (select 1 from public.request_items ri where ri.store_request_id = sr.id)
    on conflict (cycle_id, store_id) do nothing;

    insert into public.delivery_item_checks (delivery_id, request_item_id)
    select d.id, ri.id
    from public.deliveries d
    join public.store_requests sr on sr.cycle_id = d.cycle_id and sr.store_id = d.store_id
    join public.request_items ri  on ri.store_request_id = sr.id
    where d.cycle_id = new.id
    on conflict (delivery_id, request_item_id) do nothing;
  end if;
  return new;
end $$;

create trigger t_create_deliveries after update on public.order_cycles
  for each row execute function public.create_deliveries_for_cycle();

-- -------------------------------------------- request_items guard ----
-- Column-level + state-level rules the permission matrix requires but RLS
-- (row-level only) cannot express:
--   PIC:     edit item/qty/unit only while cycle OPEN; may set selling_price
--            only after PURCHASED; may NEVER touch purchased_qty/unit_cost.
--   Manager: may set purchased_qty/unit_cost only in ORDERED/PURCHASED;
--            may NEVER touch selling_price or the requested lines.
create or replace function public.request_items_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r  public.user_role := public.get_my_role();
  cs public.cycle_status;
begin
  select oc.status into cs
  from public.store_requests sr
  join public.order_cycles oc on oc.id = sr.cycle_id
  where sr.id = new.store_request_id;

  if r is null or r = 'superadmin' then
    return new;                                   -- service role / superadmin
  end if;

  if tg_op = 'INSERT' then
    if r <> 'pic' then
      raise exception 'Only the store PIC can add request items';
    end if;
    if cs <> 'OPEN' then
      raise exception 'Cycle is locked — items can no longer be added';
    end if;
    if new.purchased_qty is not null or new.unit_cost is not null or new.selling_price is not null then
      raise exception 'Purchase fields cannot be set at request time';
    end if;
    return new;
  end if;

  -- UPDATE
  if r = 'pic' then
    if new.purchased_qty is distinct from old.purchased_qty
      or new.unit_cost   is distinct from old.unit_cost then
      raise exception 'PIC cannot modify cost fields';
    end if;
    if (new.item_id is distinct from old.item_id
        or new.requested_qty is distinct from old.requested_qty
        or new.unit is distinct from old.unit)
       and cs <> 'OPEN' then
      raise exception 'Cycle is locked — request can no longer be edited';
    end if;
    if new.selling_price is distinct from old.selling_price
       and cs not in ('PURCHASED', 'IN_DELIVERY', 'COMPLETED') then
      raise exception 'Selling price can be set only after purchase';
    end if;
    return new;
  elsif r = 'manager' then
    if new.selling_price is distinct from old.selling_price then
      raise exception 'Manager cannot set selling prices';
    end if;
    if new.item_id is distinct from old.item_id
      or new.requested_qty is distinct from old.requested_qty
      or new.unit is distinct from old.unit then
      raise exception 'Manager cannot change requested lines';
    end if;
    if (new.purchased_qty is distinct from old.purchased_qty
        or new.unit_cost is distinct from old.unit_cost)
       and cs not in ('ORDERED', 'PURCHASED') then
      raise exception 'Cost entry is only allowed after ordering';
    end if;
    return new;
  end if;

  raise exception 'Not allowed';
end $$;

create trigger t_guard_request_items before insert or update on public.request_items
  for each row execute function public.request_items_guard();

-- ---------------------------------------------- deliveries state guard ----
-- "Loaded" is only valid with a photo AND every checklist item ticked —
-- enforced HERE, not in the UI. PIC (or manager) confirms RECEIVED.
create or replace function public.deliveries_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.get_my_role();
begin
  if r = 'superadmin' or r is null then
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'PENDING' and new.status = 'LOADED' then
      if r <> 'driver' then
        raise exception 'Only a driver can mark a delivery as loaded';
      end if;
      if new.photo_path is null then
        raise exception 'A loading photo is required before marking as loaded';
      end if;
      if exists (select 1 from public.delivery_item_checks c
                 where c.delivery_id = new.id and not c.checked) then
        raise exception 'All items must be checked before marking as loaded';
      end if;
      new.driver_id := auth.uid();
      new.loaded_at := now();
    elsif old.status = 'LOADED' and new.status = 'RECEIVED' then
      if r not in ('pic', 'manager') then
        raise exception 'Only the store PIC or manager can confirm receipt';
      end if;
      new.received_at := now();
    else
      raise exception 'Invalid delivery transition: % -> %', old.status, new.status;
    end if;
  end if;

  -- Drivers may only attach a photo / flip status; nothing else.
  if r = 'driver'
     and (new.cycle_id is distinct from old.cycle_id
          or new.store_id is distinct from old.store_id) then
    raise exception 'Drivers cannot reassign deliveries';
  end if;
  return new;
end $$;

create trigger t_guard_deliveries before update on public.deliveries
  for each row execute function public.deliveries_guard();

-- Checklist ticks are only editable while the delivery is still PENDING.
create or replace function public.delivery_checks_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.get_my_role();
  ds public.delivery_status;
begin
  if r = 'superadmin' or r is null then
    return new;
  end if;
  select status into ds from public.deliveries where id = new.delivery_id;
  if ds <> 'PENDING' then
    raise exception 'Checklist is frozen once the delivery is loaded';
  end if;
  if new.delivery_id is distinct from old.delivery_id
     or new.request_item_id is distinct from old.request_item_id then
    raise exception 'Checklist rows cannot be reassigned';
  end if;
  return new;
end $$;

create trigger t_guard_dic before update on public.delivery_item_checks
  for each row execute function public.delivery_checks_guard();

-- ------------------------------------- auto-advance cycle on deliveries ----
-- All stores LOADED  -> cycle IN_DELIVERY.  All stores RECEIVED -> COMPLETED.
-- SECURITY DEFINER: drivers/PICs have no UPDATE grant on order_cycles; the
-- owner (postgres) bypasses RLS for exactly these two legal transitions,
-- which order_cycle_guard still validates.
create or replace function public.advance_cycle_on_delivery()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status in ('LOADED', 'RECEIVED') then
    if not exists (select 1 from public.deliveries
                   where cycle_id = new.cycle_id and status = 'PENDING') then
      update public.order_cycles set status = 'IN_DELIVERY'
      where id = new.cycle_id and status = 'PURCHASED';
    end if;
    if not exists (select 1 from public.deliveries
                   where cycle_id = new.cycle_id and status <> 'RECEIVED') then
      update public.order_cycles set status = 'COMPLETED'
      where id = new.cycle_id and status = 'IN_DELIVERY';
    end if;
  end if;
  return new;
end $$;

create trigger t_advance_cycle after update on public.deliveries
  for each row execute function public.advance_cycle_on_delivery();
