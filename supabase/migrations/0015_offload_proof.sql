-- ============================================================================
-- 0015_offload_proof.sql — offload photo, guard, storage window, notification
--
-- RUN 0014 FIRST and let it commit; this file references the OFFLOADED enum
-- value in a trigger WHEN clause, which Postgres rejects if the value was
-- added in the same transaction.
-- ============================================================================

-- ------------------------------------------------------------- columns -----
alter table public.deliveries
  add column if not exists offload_photo_path text
    check (char_length(offload_photo_path) <= 300),
  add column if not exists offloaded_at timestamptz;

-- ------------------------------------------------------ deliveries guard ---
-- Same shape as 0002, with OFFLOADED spliced between LOADED and RECEIVED.
-- The offload photo is required by the DATABASE, exactly like the loading
-- photo: a driver cannot mark a drop-off done without proof, whatever the
-- client sends.
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

    elsif old.status = 'LOADED' and new.status = 'OFFLOADED' then
      if r <> 'driver' then
        raise exception 'Only a driver can mark a delivery as offloaded';
      end if;
      if new.offload_photo_path is null then
        raise exception 'An offloading photo is required at the branch';
      end if;
      new.offloaded_at := now();

    elsif old.status = 'OFFLOADED' and new.status = 'RECEIVED' then
      if r not in ('pic', 'manager') then
        raise exception 'Only the store PIC or manager can confirm receipt';
      end if;
      new.received_at := now();

    else
      raise exception 'Invalid delivery transition: % -> %', old.status, new.status;
    end if;
  end if;

  -- Drivers may only attach photos / flip status; nothing else.
  if r = 'driver'
     and (new.cycle_id is distinct from old.cycle_id
          or new.store_id is distinct from old.store_id) then
    raise exception 'Drivers cannot reassign deliveries';
  end if;
  return new;
end $$;

-- ------------------------------------------- cycle advance includes OFFLOADED
-- Without this the cycle would never reach IN_DELIVERY once OFFLOADED exists,
-- because the old trigger only reacted to LOADED and RECEIVED.
create or replace function public.advance_cycle_on_delivery()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status in ('LOADED', 'OFFLOADED', 'RECEIVED') then
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

-- ------------------------------------------------- storage upload window ---
-- 0005 only allowed writes while the delivery was PENDING, which would block
-- the offload photo (taken while LOADED). Widen to both, and no further: once
-- the drop-off is recorded, neither photo can be replaced.
-- Both names are dropped: the 0005 name on a first run, the new name if this
-- file is re-run. CREATE POLICY has no IF NOT EXISTS.
drop policy if exists "driver uploads loading photo" on storage.objects;
drop policy if exists "driver uploads delivery photo" on storage.objects;
create policy "driver uploads delivery photo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and public.get_my_role() = 'driver'
  and exists (
    select 1 from public.deliveries d
    where d.id::text = (storage.foldername(name))[1]
      and d.status in ('PENDING', 'LOADED')
  )
);

drop policy if exists "driver replaces pending photo" on storage.objects;
drop policy if exists "driver replaces delivery photo" on storage.objects;
create policy "driver replaces delivery photo"
on storage.objects for update to authenticated
using (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and public.get_my_role() = 'driver'
  and exists (
    select 1 from public.deliveries d
    where d.id::text = (storage.foldername(name))[1]
      and d.status in ('PENDING', 'LOADED')
  )
);

drop policy if exists "driver deletes pending photo" on storage.objects;
drop policy if exists "driver deletes delivery photo" on storage.objects;
create policy "driver deletes delivery photo"
on storage.objects for delete to authenticated
using (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and public.get_my_role() = 'driver'
  and exists (
    select 1 from public.deliveries d
    where d.id::text = (storage.foldername(name))[1]
      and d.status in ('PENDING', 'LOADED')
  )
);

-- ------------------------------------------------------------ notification --
-- The shop learns the goods are at their door without watching the app.
-- Recipients resolved in send-push (managers + that store's PIC).
drop trigger if exists t_notify_delivery_offloaded on public.deliveries;
create trigger t_notify_delivery_offloaded
  after update on public.deliveries
  for each row
  when (old.status is distinct from new.status and new.status = 'OFFLOADED')
  execute function public.notify_push('delivery_offloaded');
