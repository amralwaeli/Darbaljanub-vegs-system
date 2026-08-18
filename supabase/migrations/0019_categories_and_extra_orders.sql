-- ============================================================================
-- 0019_categories_and_extra_orders.sql
--
-- TWO changes that go together, because both are about the manager being able
-- to act on what arrives:
--
-- 1. CATEGORIES. Items and vendors are grouped (البطاطس والبصل, الورقيات,
--    الخضار, الفواكه, الفواكه المستوردة, ...). The manager can add more later.
--    A submitted request then reads as "these are the leafy greens", which is
--    the order the manager actually buys in — one category, one vendor.
--
-- 2. MORE THAN ONE ORDER PER BRANCH PER CYCLE. Until now `unique (cycle_id,
--    store_id)` meant a branch had exactly one shot: press Send and anything
--    forgotten was gone until tomorrow. Branches forget items, so they may now
--    send a follow-up order. Each send is its own row with its own `seq`, so
--    the manager sees "طلب #2" as a distinct addition rather than a silently
--    changed total.
--
-- Free tier: `categories` holds a handful of rows; the rest is two FK columns,
-- one small int column and four indexes. Storage impact is effectively zero.
-- ============================================================================

-- ============================================================== categories ==
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 60),
  emoji      text check (char_length(emoji) <= 8),
  -- Display order the manager controls; ties fall back to name.
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categories_sort_idx
  on public.categories (sort_order, name);

drop trigger if exists t_upd_categories on public.categories;
create trigger t_upd_categories before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists t_audit_categories on public.categories;
create trigger t_audit_categories
  after insert or update or delete on public.categories
  for each row execute function public.record_audit();

-- The five the business starts with. ON CONFLICT so re-running is harmless.
insert into public.categories (name, emoji, sort_order) values
  ('البطاطس والبصل',     '🥔', 10),
  ('الورقيات',           '🥬', 20),
  ('الخضار',             '🍅', 30),
  ('الفواكه',            '🍎', 40),
  ('الفواكه المستوردة',  '🍍', 50)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- RLS ------
alter table public.categories enable row level security;

-- Everyone active reads them: the PIC's item picker groups by category too.
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (public.is_active_user());

-- Only the manager curates the catalogue structure.
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all to authenticated
  using (
    public.is_active_user()
    and public.get_my_role() in ('manager', 'superadmin')
  )
  with check (
    public.is_active_user()
    and public.get_my_role() in ('manager', 'superadmin')
  );

-- ================================================= items / vendors links ===
-- Both nullable: existing rows stay valid and simply show as "غير مصنف" until
-- the manager files them. `on delete set null` so removing a category never
-- takes items or vendors with it.
alter table public.items
  add column if not exists category_id uuid references public.categories (id) on delete set null;

alter table public.vendors
  add column if not exists category_id uuid references public.categories (id) on delete set null;

create index if not exists items_category_idx   on public.items (category_id);
create index if not exists vendors_category_idx on public.vendors (category_id);

comment on column public.items.category_id is
  'Which category this item belongs to (0019). NULL = not yet filed.';
comment on column public.vendors.category_id is
  'The single category this vendor supplies (0019). NULL = not yet filed.';

-- ======================================= more than one order per branch =====
-- Which send this was, per branch per cycle: 1, then 2, then 3...
alter table public.store_requests
  add column if not exists seq int not null default 1;

-- The old "one request per store per cycle" rule is exactly what we are
-- removing. Found by its COLUMNS rather than by the name Postgres happened to
-- generate in 0001, so this cannot silently no-op on a differently-named
-- constraint and leave branches unable to send a second order.
do $do$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'store_requests'
    and con.contype = 'u'
    and con.conkey @> array[
      (select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'cycle_id'),
      (select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'store_id')
    ]
    and array_length(con.conkey, 1) = 2;

  if constraint_name is not null then
    execute format(
      'alter table public.store_requests drop constraint %I', constraint_name);
  end if;
end $do$;

-- Still no duplicates: a branch has one row per send.
create unique index if not exists store_requests_cycle_store_seq_key
  on public.store_requests (cycle_id, store_id, seq);

-- At most ONE unsent draft at a time per branch, so "my current list" is never
-- ambiguous. Sent rows are unlimited.
create unique index if not exists store_requests_one_open_draft
  on public.store_requests (cycle_id, store_id)
  where status = 'DRAFT';

-- Assign seq server-side; the client must not pick it.
create or replace function public.set_store_request_seq()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select coalesce(max(seq), 0) + 1
    into new.seq
  from public.store_requests
  where cycle_id = new.cycle_id
    and store_id = new.store_id;
  return new;
end $$;

drop trigger if exists t_set_store_request_seq on public.store_requests;
create trigger t_set_store_request_seq before insert on public.store_requests
  for each row execute function public.set_store_request_seq();

-- Existing rows keep seq = 1, which is correct: they were the only send.

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
