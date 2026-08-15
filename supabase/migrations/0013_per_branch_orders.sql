-- ============================================================================
-- 0013_per_branch_orders.sql — one vendor order per branch, and managers may
-- add lines to a request after it has been sent
--
-- 1. Vendor orders are now placed per BRANCH: the vendor delivers to each shop
--    and the message names the shop, so the order has to record which one.
-- 2. Until now only a PIC could add a line, and only to their own DRAFT. The
--    manager and superadmin can now add lines to any request at any point
--    before the cycle is finished — a manager on the phone with the market
--    needs to be able to tack on an item nobody asked for.
-- ============================================================================

-- --------------------------------------------------- vendor_orders.store ---
-- Nullable: rows written before this migration were aggregated across every
-- branch and cannot be attributed to one.
alter table public.vendor_orders
  add column if not exists store_id uuid references public.stores (id) on delete set null;

create index if not exists vendor_orders_store_idx on public.vendor_orders (store_id);

-- ------------------------------------- managers may add lines after send ---
create or replace function public.request_items_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r  public.user_role := public.get_my_role();
  cs public.cycle_status;
  rs public.request_status;
begin
  select oc.status, sr.status into cs, rs
  from public.store_requests sr
  join public.order_cycles oc on oc.id = sr.cycle_id
  where sr.id = new.store_request_id;

  if r is null or r = 'superadmin' then
    return new;                                   -- service role / superadmin
  end if;

  if tg_op = 'INSERT' then
    if new.purchased_qty is not null or new.unit_cost is not null or new.selling_price is not null then
      raise exception 'Purchase fields cannot be set at request time';
    end if;

    -- The manager may add an item to any live cycle, including one already
    -- sent to the market: they are the one talking to the vendor.
    if r = 'manager' then
      if cs = 'COMPLETED' then
        raise exception 'This cycle is finished';
      end if;
      return new;
    end if;

    if r <> 'pic' then
      raise exception 'Only the store PIC or the manager can add request items';
    end if;
    if cs <> 'OPEN' then
      raise exception 'Cycle is locked — items can no longer be added';
    end if;
    if rs <> 'DRAFT' then
      raise exception 'This request was already sent — ask the manager to add it';
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
       and rs <> 'DRAFT' then
      raise exception 'This request was already sent — ask the manager to change it';
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
      or new.unit is distinct from old.unit then
      raise exception 'Manager cannot change which item was requested';
    end if;
    if new.requested_qty is distinct from old.requested_qty
       and rs <> 'SUBMITTED' then
      raise exception 'Only a request the store has sent can be adjusted';
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

-- RLS has to let the row through before the guard above can judge it.
drop policy if exists request_items_insert on public.request_items;
create policy request_items_insert on public.request_items
  for insert to authenticated
  with check (
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

-- A manager adding an item to a store that never sent anything needs a request
-- row to hang it on. SECURITY DEFINER so the manager-only insert policy on
-- store_requests (PIC-scoped) does not block them.
create or replace function public.manager_request_for_store(
  p_cycle_id uuid,
  p_store_id uuid
)
returns public.store_requests
language plpgsql security definer
set search_path = public
as $$
declare
  req public.store_requests;
begin
  if not public.is_active_user()
     or public.get_my_role() not in ('manager', 'superadmin') then
    raise exception 'Not authorized';
  end if;

  select * into req from public.store_requests
  where cycle_id = p_cycle_id and store_id = p_store_id;
  if found then
    return req;
  end if;

  -- Created already SUBMITTED: a manager adding lines on the vendor's behalf
  -- is not a draft the store is still building.
  insert into public.store_requests (cycle_id, store_id, created_by, status)
  values (p_cycle_id, p_store_id, auth.uid(), 'SUBMITTED')
  returning * into req;
  return req;
exception when unique_violation then
  select * into req from public.store_requests
  where cycle_id = p_cycle_id and store_id = p_store_id;
  return req;
end $$;

revoke all on function public.manager_request_for_store(uuid, uuid) from public;
grant execute on function public.manager_request_for_store(uuid, uuid) to authenticated;
