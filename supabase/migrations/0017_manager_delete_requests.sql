-- ============================================================================
-- 0017_manager_delete_requests.sql — the manager can remove lines and whole
-- requests, not just add them
--
-- 0013 let the manager ADD a line to any live cycle, because they are the one
-- talking to the market. The reverse was never granted: request_items_delete
-- and store_requests_delete were PIC/superadmin only, so a manager who was
-- told an item is unavailable could not take it off the order.
--
-- Bound: OPEN / ORDERED / PURCHASED. Deliberately NOT IN_DELIVERY or
-- COMPLETED — request_items is the parent of delivery_item_checks via ON
-- DELETE CASCADE, so deleting a line once the driver has loaded would silently
-- destroy the checklist that the loading photo is proof of. Superadmin keeps
-- the unrestricted override it has everywhere else.
--
-- Deleting a store_request cascades to its request_items (0001), which is the
-- intent: "this branch is not ordering today".
-- ============================================================================

drop policy if exists request_items_delete on public.request_items;
create policy request_items_delete on public.request_items
  for delete to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'manager'
        and exists (
          select 1
          from public.store_requests sr
          join public.order_cycles oc on oc.id = sr.cycle_id
          where sr.id = store_request_id
            and oc.status in ('OPEN', 'ORDERED', 'PURCHASED')
        )
      )
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

drop policy if exists store_requests_delete on public.store_requests;
create policy store_requests_delete on public.store_requests
  for delete to authenticated
  using (
    public.is_active_user() and (
      public.get_my_role() = 'superadmin'
      or (
        public.get_my_role() = 'manager'
        and exists (
          select 1 from public.order_cycles oc
          where oc.id = cycle_id
            and oc.status in ('OPEN', 'ORDERED', 'PURCHASED')
        )
      )
      or (
        public.get_my_role() = 'pic'
        and store_id = public.get_my_store_id()
        and exists (
          select 1 from public.order_cycles oc
          where oc.id = cycle_id and oc.status = 'OPEN'
        )
      )
    )
  );
