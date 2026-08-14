-- ============================================================================
-- 0008_push_notifications.sql — Web Push infrastructure
--
-- Three events fire a push notification, straight from the DATABASE (no
-- client cooperation needed), via pg_net -> the send-push Edge Function:
--   1. A PIC submits a store request        -> notify managers
--   2. A driver marks a delivery LOADED     -> notify managers + that store's PIC
--   3. The cycle turns PURCHASED (costs in) -> notify all PICs
--
-- ONE-TIME CONFIG after deploying the send-push function (see README):
--   update public.app_config set value = 'https://<ref>.supabase.co'  where key = 'edge_base_url';
--   update public.app_config set value = '<same as PUSH_WEBHOOK_SECRET>' where key = 'push_webhook_secret';
-- Until both are set, the triggers no-op silently (pushes just don't send).
-- ============================================================================

create extension if not exists pg_net;

-- ------------------------------------------------------- app_config --------
-- Service-side key/value config. RLS enabled with NO policies: invisible and
-- unwritable to every client role; only service role / SQL editor touch it.
create table public.app_config (
  key   text primary key,
  value text not null default ''
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

insert into public.app_config (key, value) values
  ('edge_base_url', ''),
  ('push_webhook_secret', '')
on conflict (key) do nothing;

-- ------------------------------------------------- push_subscriptions ------
-- One row per device/browser a user enabled notifications on.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Users manage only their own device subscriptions.
create policy push_subs_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());

create policy push_subs_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

create policy push_subs_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

create policy push_subs_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid() and public.is_active_user());

-- --------------------------------------------------- notify trigger --------
-- SECURITY DEFINER (needs to read app_config). Any failure is swallowed:
-- a broken notification pipeline must NEVER block a business write.
create or replace function public.notify_push()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  base_url text;
  secret   text;
begin
  select value into base_url from public.app_config where key = 'edge_base_url';
  select value into secret   from public.app_config where key = 'push_webhook_secret';
  if coalesce(base_url, '') = '' or coalesce(secret, '') = '' then
    return coalesce(new, old);          -- push not configured yet: skip
  end if;

  perform net.http_post(
    url     := base_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', secret
    ),
    body    := jsonb_build_object(
      'event',  tg_argv[0],
      'record', to_jsonb(new)
    )
  );
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end $$;

-- Event 1: PIC submitted a request list
create trigger t_notify_request_submitted
  after insert on public.store_requests
  for each row
  execute function public.notify_push('request_submitted');

-- Event 2: driver loaded a delivery
create trigger t_notify_delivery_loaded
  after update on public.deliveries
  for each row
  when (old.status is distinct from new.status and new.status = 'LOADED')
  execute function public.notify_push('delivery_loaded');

-- Event 3: manager finished cost entry (cycle -> PURCHASED)
create trigger t_notify_costs_ready
  after update on public.order_cycles
  for each row
  when (old.status is distinct from new.status and new.status = 'PURCHASED')
  execute function public.notify_push('costs_ready');
