-- ============================================================================
-- 0004_driver_view.sql — price-free view for drivers
--
-- Drivers have ZERO row access to request_items (no RLS policy there), so
-- they cannot select price columns no matter what query they craft against
-- PostgREST. This view — owned by postgres, so it bypasses the underlying
-- RLS — is their ONLY window into checklist item data, and it simply does
-- not contain price columns. The WHERE clause re-implements row scoping for
-- every role that may use it.
-- ============================================================================

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
  ri.unit
from public.delivery_item_checks dic
join public.request_items ri on ri.id = dic.request_item_id
join public.items i          on i.id  = ri.item_id
join public.deliveries d     on d.id  = dic.delivery_id
where
  public.is_active_user()
  and (
    public.get_my_role() in ('driver', 'manager', 'superadmin')
    or (public.get_my_role() = 'pic' and d.store_id = public.get_my_store_id())
  );

comment on view public.driver_delivery_items is
  'Price-free checklist join for drivers. Owned by postgres (bypasses RLS on the underlying tables) with explicit role scoping in WHERE. Deliberately contains no cost/price columns.';

grant select on public.driver_delivery_items to authenticated;
revoke all on public.driver_delivery_items from anon;
