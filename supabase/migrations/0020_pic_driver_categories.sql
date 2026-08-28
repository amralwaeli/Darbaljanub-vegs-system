-- ============================================================================
-- 0020_pic_driver_categories.sql
--
-- Two jobs in one file.
--
-- A. REPAIR — 0019 only landed HALFWAY in production.
--    Verified against the live database: the categories table, its seed rows,
--    items.category_id, vendors.category_id and store_requests.seq are all
--    present, but the functions at the end of 0019 are NOT:
--
--      ensure_store_draft   -> missing  (PostgREST: PGRST202)
--      set_category_items   -> missing  (PostgREST: PGRST202)
--
--    which is exactly why a PIC adding an item gets
--      "Could not find the function public.ensure_store_draft(p_cycle_id,
--       p_store_id) in the schema cache".
--
--    The run stopped somewhere after the seq trigger, so store_requests_guard
--    and manager_request_for_store may also still be their pre-0019 versions.
--    Those two cannot be told apart from the outside (they existed in
--    0012/0013 under the same names), so 0019's whole function section is
--    re-asserted below rather than guessed at. Every statement is CREATE OR
--    REPLACE: on a database where 0019 completed cleanly this section changes
--    nothing.
--
-- B. FEATURE — categories reach the PIC and the driver.
--    The PIC filters the item picker by category; the driver reads the
--    loading checklist one category at a time. The driver side needs the
--    category on driver_delivery_items, which is the driver's ONLY window
--    into checklist data (0004) — and it must stay price-free.
-- ============================================================================


-- ============================================================================
-- A. Re-assert 0019's function section (verbatim from
--    0019_categories_and_extra_orders.sql, lines 161-362).
-- ============================================================================

-- ----------------------------------------------- guard: seq is immutable ---
-- store_requests_guard (0012) already blocks moving a request between stores
-- and cycles, and blocks a PIC un-sending. seq belongs in that same set: it
-- identifies the send and must never be rewritten afterwards.
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

  if new.seq is distinct from old.seq then
    raise exception 'The order number cannot be changed';
  end if;

  return new;
end $$;

-- The DRAFT -> SUBMITTED notify trigger (0012) is per ROW, so a follow-up
-- order notifies the manager exactly like the first one did. Nothing to change.

-- ------------------------------------------ manager_request_for_store ------
-- 0013's version did `select * into req ... where cycle_id/store_id`, which
-- assumed exactly one row. Now that a branch can have several orders, that
-- SELECT INTO would take an ARBITRARY one — the manager's added line could
-- silently land on the morning order instead of the latest.
--
-- It must also never target the branch's OPEN DRAFT. A draft is a list the
-- branch is still building and has not sent: a line the manager adds there is
-- invisible to them as an order, and the branch can still edit or delete it.
-- So: newest SUBMITTED order, or a fresh SUBMITTED one if the branch has not
-- sent anything yet.
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
  where cycle_id = p_cycle_id
    and store_id = p_store_id
    and status = 'SUBMITTED'
  order by seq desc
  limit 1;
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
  where cycle_id = p_cycle_id
    and store_id = p_store_id
    and status = 'SUBMITTED'
  order by seq desc
  limit 1;
  return req;
end $$;

revoke all on function public.manager_request_for_store(uuid, uuid) from public;
grant execute on function public.manager_request_for_store(uuid, uuid) to authenticated;

-- ----------------------------------------------- set_category_items --------
-- Assign exactly this set of items to a category, atomically.
--
-- SECURITY DEFINER for a consistent authorisation check in one place; the RLS
-- policies on items would allow a manager to do this anyway, so the function
-- grants no new power — it only makes the pair of writes indivisible.
create or replace function public.set_category_items(
  p_category_id uuid,
  p_item_ids    uuid[]
)
returns void
language plpgsql security definer
set search_path = public
as $fn$
begin
  if not public.is_active_user()
     or public.get_my_role() not in ('manager', 'superadmin') then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Unknown category';
  end if;

  -- Un-file what was removed. An empty array clears the category, which is
  -- what unticking every box means.
  update public.items
  set category_id = null
  where category_id = p_category_id
    and not (id = any(coalesce(p_item_ids, '{}'::uuid[])));

  -- File what was chosen, moving it out of any other category it was in.
  update public.items
  set category_id = p_category_id
  where id = any(coalesce(p_item_ids, '{}'::uuid[]))
    and category_id is distinct from p_category_id;
end $fn$;

revoke all on function public.set_category_items(uuid, uuid[]) from public;
grant execute on function public.set_category_items(uuid, uuid[]) to authenticated;

-- ------------------------------------------------ ensure_store_draft -------
-- Returns the branch's open DRAFT for this cycle, creating one if it has none.
-- Safe to call concurrently: a lost race is caught and re-read rather than
-- surfacing a unique-violation to the user.
create or replace function public.ensure_store_draft(
  p_cycle_id uuid,
  p_store_id uuid
)
returns public.store_requests
language plpgsql security definer
set search_path = public
as $fn$
declare
  req public.store_requests;
  -- Named r, not "role": role is a SQL keyword and can misparse inside
  -- PL/pgSQL expressions. Matches the existing guards in 0012/0013.
  r   public.user_role := public.get_my_role();
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  -- A PIC may only ever open a draft for their OWN branch. SECURITY DEFINER
  -- bypasses RLS, so this check is what replaces it.
  if r = 'pic' then
    if p_store_id is distinct from public.get_my_store_id() then
      raise exception 'Not authorized';
    end if;
  elsif r not in ('manager', 'superadmin') then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from public.order_cycles
    where id = p_cycle_id and status = 'OPEN'
  ) then
    raise exception 'Cycle is locked — items can no longer be added';
  end if;

  select * into req from public.store_requests
  where cycle_id = p_cycle_id
    and store_id = p_store_id
    and status = 'DRAFT'
  limit 1;
  if found then
    return req;
  end if;

  insert into public.store_requests (cycle_id, store_id, created_by, status)
  values (p_cycle_id, p_store_id, auth.uid(), 'DRAFT')
  returning * into req;
  return req;
exception when unique_violation then
  -- Someone else created it between the SELECT and the INSERT.
  select * into req from public.store_requests
  where cycle_id = p_cycle_id
    and store_id = p_store_id
    and status = 'DRAFT'
  limit 1;
  return req;
end $fn$;

revoke all on function public.ensure_store_draft(uuid, uuid) from public;
grant execute on function public.ensure_store_draft(uuid, uuid) to authenticated;


-- ============================================================================
-- B. Categories on the driver's checklist view.
--
-- Dropped and recreated rather than CREATE OR REPLACE'd: replace can only
-- append columns and would pin the category fields to the end of the row
-- forever. The grants and the comment are re-applied below, exactly as 0004
-- set them.
--
-- Still price-free. The added columns are category name/emoji/sort — nothing
-- about cost enters the driver's window, which is the whole point of 0004.
-- The join to categories happens INSIDE a view owned by postgres, so it does
-- not depend on the driver's own RLS grant on categories.
-- ============================================================================
drop view if exists public.driver_delivery_items;

create view public.driver_delivery_items
with (security_barrier) as
select
  dic.id                                        as check_id,
  dic.delivery_id,
  dic.checked,
  ri.id                                         as request_item_id,
  i.name                                        as item_name,
  i.emoji                                       as item_emoji,
  coalesce(ri.purchased_qty, ri.requested_qty)  as qty,
  ri.unit,
  -- 0020: what the driver groups by. NULL = the manager has not filed this
  -- item yet, which the UI shows as its own "غير مصنف" group rather than
  -- dropping the line — a crate nobody sorted still has to get on the truck.
  i.category_id,
  c.name                                        as category_name,
  c.emoji                                       as category_emoji,
  c.sort_order                                  as category_sort
from public.delivery_item_checks dic
join public.request_items ri on ri.id = dic.request_item_id
join public.items i          on i.id  = ri.item_id
join public.deliveries d     on d.id  = dic.delivery_id
-- LEFT: an unfiled item, or one whose category was deleted, must still
-- appear on the checklist.
left join public.categories c on c.id = i.category_id
where
  public.is_active_user()
  and (
    public.get_my_role() in ('driver', 'manager', 'superadmin')
    or (public.get_my_role() = 'pic' and d.store_id = public.get_my_store_id())
  );

comment on view public.driver_delivery_items is
  'Price-free checklist join for drivers. Owned by postgres (bypasses RLS on the underlying tables) with explicit role scoping in WHERE. Deliberately contains no cost/price columns. 0020 adds the item category so the driver can load one category at a time.';

grant select on public.driver_delivery_items to authenticated;
revoke all on public.driver_delivery_items from anon;
