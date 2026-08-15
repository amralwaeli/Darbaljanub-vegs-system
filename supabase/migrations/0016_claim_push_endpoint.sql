-- ============================================================================
-- 0016_claim_push_endpoint.sql — let a device's push endpoint change hands
--
-- Symptom: enabling notifications failed with "something went wrong" for any
-- user signing in on a device where a DIFFERENT user had already enabled them.
--
-- Cause: a Web Push endpoint identifies a BROWSER, not a person, so it is
-- stable across who is logged in. The client upserted on that endpoint, which
-- becomes UPDATE when the row exists, and push_subs_update_own has
-- `using (user_id = auth.uid())` — so claiming another user's row is
-- (correctly) rejected with 42501.
--
-- Leaving the stale row is not merely inconvenient, it is wrong: the previous
-- user's notifications would keep being delivered to a device somebody else is
-- now holding. The endpoint must follow the device.
--
-- SECURITY DEFINER because the caller legitimately cannot delete a row they do
-- not own. The blast radius is one endpoint, and only an active authenticated
-- user can call it — they must already control that device to know its
-- endpoint, and the endpoint is unguessable.
-- ============================================================================

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
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

  -- Whoever is signed in on this device now owns its notifications.
  delete from public.push_subscriptions where endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;

revoke all on function public.register_push_subscription(text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;
