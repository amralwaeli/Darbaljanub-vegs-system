-- ============================================================================
-- 0010_role_notifications.sql — every role hears about the steps that concern it
--
-- 0008 covered three events and left gaps: the DRIVER was never notified of
-- anything at all, the manager never learned a store had confirmed receipt,
-- and PICs were not told their request had gone to the market.
--
-- Full matrix after this migration (recipients resolved in send-push):
--
--   event              fires when                        goes to
--   -----------------  --------------------------------  --------------------
--   request_submitted  a store files its first item      managers + superadmin
--   order_sent         cycle OPEN -> ORDERED             PICs
--   costs_ready        cycle -> PURCHASED                PICs
--   deliveries_ready   cycle -> PURCHASED                drivers
--   delivery_loaded    delivery -> LOADED                managers + that PIC
--   delivery_received  delivery -> RECEIVED              managers + superadmin
--
-- costs_ready and deliveries_ready share a transition but carry different
-- messages for different roles, so they stay separate events.
--
-- Reuses public.notify_push() from 0008 unchanged: it reads app_config and
-- swallows every failure, so a broken push pipeline can never block a write.
-- ============================================================================

-- The manager locked the list and is heading to the market: PICs can stop
-- editing and will see cost prices later.
drop trigger if exists t_notify_order_sent on public.order_cycles;
create trigger t_notify_order_sent
  after update on public.order_cycles
  for each row
  when (old.status = 'OPEN' and new.status = 'ORDERED')
  execute function public.notify_push('order_sent');

-- Costs are in, so the delivery rows now exist (see create_deliveries_for_cycle
-- in 0002). This is the first moment a driver has anything to load.
drop trigger if exists t_notify_deliveries_ready on public.order_cycles;
create trigger t_notify_deliveries_ready
  after update on public.order_cycles
  for each row
  when (old.status is distinct from new.status and new.status = 'PURCHASED')
  execute function public.notify_push('deliveries_ready');

-- A store confirmed the goods arrived — closes the loop for the manager.
drop trigger if exists t_notify_delivery_received on public.deliveries;
create trigger t_notify_delivery_received
  after update on public.deliveries
  for each row
  when (old.status is distinct from new.status and new.status = 'RECEIVED')
  execute function public.notify_push('delivery_received');
