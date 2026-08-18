-- ============================================================================
-- 0018_native_push.sql — deliver notifications to the native Android app
--
-- The app moved from a TWA (a Chrome tab in an app costume) to a real
-- Capacitor shell. That changes the push TRANSPORT:
--
--   website  -> Web Push / VAPID, keyed by a browser endpoint URL  (unchanged)
--   Android  -> FCM, keyed by a device registration token          (new)
--
-- Both are stored in push_subscriptions. An FCM token plays exactly the same
-- role a Web Push endpoint does — it identifies a DEVICE, not a person — so it
-- reuses the `endpoint` column and, crucially, the claim semantics from 0016:
-- whoever is signed in on the phone now owns its notifications.
--
-- Native rows carry no ECDH keys (FCM does its own transport encryption), so
-- p256dh/auth are written as ''. The existing NOT NULL + length checks already
-- permit that, so no constraint needs relaxing.
-- ============================================================================

-- --------------------------------------------------------------- platform ---
alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check
  check (platform in ('web', 'android'));

comment on column public.push_subscriptions.platform is
  'Transport for this row: web = Web Push/VAPID endpoint, android = FCM token.';

-- send-push fans out per transport; keep that lookup cheap.
create index if not exists push_subscriptions_platform_idx
  on public.push_subscriptions (platform);

-- ------------------------------------------------------------------- RPC ---
-- The 3-arg function is REPLACED (not overloaded) by a 4-arg one with a
-- default. Overloading would leave PostgREST unable to resolve a 3-argument
-- call; with a default, existing web callers keep working untouched and
-- resolve to platform 'web'.
drop function if exists public.register_push_subscription(text, text, text);

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_platform text default 'web'
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  if coalesce(p_endpoint, '') = '' then
    raise exception 'Endpoint is required';
  end if;

  if coalesce(p_platform, '') not in ('web', 'android') then
    raise exception 'Unknown push platform: %', p_platform;
  end if;

  -- Whoever is signed in on this device now owns its notifications (0016).
  delete from public.push_subscriptions where endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
  values (auth.uid(), p_endpoint, coalesce(p_p256dh, ''), coalesce(p_auth, ''), p_platform);
end $$;

revoke all on function public.register_push_subscription(text, text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
