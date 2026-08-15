-- ============================================================================
-- 0012_submit_request_flow.sql — the PIC sends ONE finished list
--
-- Before: every tap wrote straight through. A half-built list was already
-- visible to the manager, the manager was notified on the FIRST item rather
-- than on a finished order, and the manager then had to press "lock the cycle"
-- to confirm it. Meanwhile the manager could not correct a quantity at all.
--
-- After:
--   * A store's request starts as DRAFT. The PIC adds/edits/removes freely,
--     then presses Send once -> SUBMITTED. That is when the manager is
--     notified, and from then on the PIC cannot touch it.
--   * The manager owns the numbers after submission: they may adjust
--     requested_qty on a SUBMITTED request (but never swap the item).
--   * No "lock the cycle" step. Recording the first vendor order is what
--     moves the cycle OPEN -> ORDERED; 0009's trigger then opens the next one.
--
-- The DRAFT/SUBMITTED enum already existed (0001) and was never used.
-- ============================================================================

-- A new request is a draft until the PIC sends it.
alter table public.store_requests alter column status set default 'DRAFT';

-- ------------------------------------------------- store_requests guard ----
-- Sending is one-way for a PIC: DRAFT -> SUBMITTED and never back, so a store
-- cannot quietly reopen a list the manager is already buying against.
create or replace function public.store_requests_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.user_role := public.get_my_role();
begin
  if r is null or r = 'superadmin' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if r = 'pic' then
      if not (old.status = 'DRAFT' and new.status = 'SUBMITTED') then
        raise exception 'A request that has been sent cannot be changed';
      end if;
    elsif r <> 'manager' then
      raise exception 'Not allowed';
    end if;
  end if;

  if new.store_id is distinct from old.store_id
     or new.cycle_id is distinct from old.cycle_id then
    raise exception 'A request cannot be moved to another store or cycle';
  end if;

  return new;
end $$;

drop trigger if exists t_guard_store_requests on public.store_requests;
create trigger t_guard_store_requests before update on public.store_requests
  for each row execute function public.store_requests_guard();

-- --------------------------------------------------- request_items guard ---
-- Same rules as 0002, except the PIC's editing window is now "my request is
-- still DRAFT" instead of "the cycle is OPEN", and the manager may correct
-- quantities on a sent request.
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
    if r <> 'pic' then
      raise exception 'Only the store PIC can add request items';
    end if;
    if cs <> 'OPEN' then
      raise exception 'Cycle is locked — items can no longer be added';
    end if;
    if rs <> 'DRAFT' then
      raise exception 'This request was already sent — start a new one';
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
    -- The manager may fix the NUMBERS on a sent request, never swap the item
    -- or its unit (the unit belongs to the catalogue entry).
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

-- A PIC may only delete lines from a draft.
drop policy if exists request_items_delete on public.request_items;
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
            and sr.status = 'DRAFT'
        )
      )
    )
  );

-- ------------------------------------------------------- notify on SEND ----
-- 0008 notified managers when the request ROW appeared, i.e. on the store's
-- first item. Managers now hear about a finished list instead.
drop trigger if exists t_notify_request_submitted on public.store_requests;
create trigger t_notify_request_submitted
  after update on public.store_requests
  for each row
  when (old.status = 'DRAFT' and new.status = 'SUBMITTED')
  execute function public.notify_push('request_submitted');

-- ------------------------------------ sending to a vendor locks the cycle ---
-- Replaces the manager's "lock the cycle and confirm the order" button:
-- placing the first vendor order IS the confirmation.
--
-- Failures are swallowed: recording what was sent to a vendor must never fail
-- because the cycle could not advance (e.g. a previous order is still out, per
-- the in-flight guard in 0009).
create or replace function public.lock_cycle_on_vendor_order()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.order_cycles
  set status = 'ORDERED'
  where id = new.cycle_id
    and status = 'OPEN'
    and not exists (
      select 1 from public.order_cycles
      where id <> new.cycle_id
        and status in ('ORDERED', 'PURCHASED', 'IN_DELIVERY')
    );
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists t_lock_cycle_on_vendor_order on public.vendor_orders;
create trigger t_lock_cycle_on_vendor_order
  after insert on public.vendor_orders
  for each row
  execute function public.lock_cycle_on_vendor_order();

-- ------------------------------------------------------ legacy rows --------
-- Under the old default every request was born SUBMITTED on the store's first
-- item, so "SUBMITTED" carries no information about whether anyone actually
-- pressed Send. Any request still sitting in an OPEN cycle therefore has not
-- been ordered against and belongs back in the store's hands as a draft.
-- (Requests in ORDERED or later cycles were genuinely acted on: left alone.)
update public.store_requests sr
set status = 'DRAFT'
from public.order_cycles oc
where oc.id = sr.cycle_id
  and oc.status = 'OPEN'
  and sr.status = 'SUBMITTED';
