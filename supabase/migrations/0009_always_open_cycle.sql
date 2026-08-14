-- ============================================================================
-- 0009_always_open_cycle.sql — a store can always file a request
--
-- Before: exactly ONE non-completed cycle could exist. While the manager was
-- buying or the driver was delivering, every branch was locked out with
-- "no open cycle", and after a cycle completed someone had to press
-- "Start cycle" before work could resume.
--
-- After: there is ALWAYS exactly one OPEN cycle collecting requests, and it is
-- replaced the moment the manager locks it. An in-flight cycle
-- (ORDERED / PURCHASED / IN_DELIVERY) runs alongside it, so buying today's
-- order never blocks tomorrow's requests.
--
-- Invariants (both enforced by partial unique indexes):
--   * at most one OPEN cycle
--   * at most one in-flight cycle (ORDERED / PURCHASED / IN_DELIVERY)
-- ============================================================================

-- ------------------------------------------------------------- indexes -----
-- Replaces order_cycles_single_active, which allowed only one live cycle of
-- any kind and is what blocked the branches.
drop index if exists public.order_cycles_single_active;

create unique index if not exists order_cycles_single_open
  on public.order_cycles ((true))
  where status = 'OPEN';

create unique index if not exists order_cycles_single_in_flight
  on public.order_cycles ((true))
  where status in ('ORDERED', 'PURCHASED', 'IN_DELIVERY');

-- ------------------------------------------------- friendly lock guard -----
-- The in-flight index above would reject a second lock with a raw
-- "duplicate key" error. Turn it into a message the manager can act on.
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

    -- Only one order may be out at a time: finish delivering the current one
    -- before locking the next. (Superadmin / service role may override.)
    if old.status = 'OPEN' and new.status = 'ORDERED'
       and r is not null and r <> 'superadmin'
       and exists (
         select 1 from public.order_cycles
         where id <> new.id
           and status in ('ORDERED', 'PURCHASED', 'IN_DELIVERY')
       ) then
      raise exception
        'The previous order is still in progress — finish its delivery first';
    end if;

    if old.status = 'OPEN' then
      new.locked_at := now();   -- lock timestamp when PIC editing closes
    end if;
  end if;
  return new;
end $$;

-- -------------------------------------------- auto-open the next cycle -----
-- The instant a cycle leaves OPEN, its replacement is created so branches are
-- never without somewhere to file a request.
--
-- SECURITY DEFINER: the transition can be driven by a PIC confirming receipt
-- or a driver loading, and neither has INSERT on order_cycles.
create or replace function public.open_next_cycle()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.order_cycles (created_by)
  values (coalesce(auth.uid(), new.created_by));
  return new;
exception
  when unique_violation then
    return new;   -- an OPEN cycle already exists: nothing to do
  when others then
    return new;   -- never block the business transition on housekeeping
end $$;

drop trigger if exists t_open_next_cycle on public.order_cycles;
create trigger t_open_next_cycle
  after update on public.order_cycles
  for each row
  when (old.status = 'OPEN' and new.status <> 'OPEN')
  execute function public.open_next_cycle();

-- ------------------------------------------------ bootstrap / self-heal ----
-- Returns the OPEN cycle, creating it if the table is empty or an OPEN cycle
-- was deleted. Any active user may call it — a PIC opening the app must not
-- have to wait for a manager. SECURITY DEFINER because cycles_insert_admin
-- restricts INSERT to manager/superadmin.
create or replace function public.ensure_open_cycle()
returns public.order_cycles
language plpgsql security definer
set search_path = public
as $$
declare
  cycle public.order_cycles;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  select * into cycle from public.order_cycles where status = 'OPEN' limit 1;
  if found then
    return cycle;
  end if;

  insert into public.order_cycles (created_by) values (auth.uid())
  returning * into cycle;
  return cycle;
exception when unique_violation then
  -- another device created it a moment ago
  select * into cycle from public.order_cycles where status = 'OPEN' limit 1;
  return cycle;
end $$;

revoke all on function public.ensure_open_cycle() from public;
grant execute on function public.ensure_open_cycle() to authenticated;

-- Make the invariant true right now, for the already-running deployment.
insert into public.order_cycles (created_by)
select null::uuid
where not exists (select 1 from public.order_cycles where status = 'OPEN');
