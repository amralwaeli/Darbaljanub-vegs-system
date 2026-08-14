-- ============================================================================
-- 0006_realtime.sql — enable postgres_changes realtime on the live tables
--
-- Realtime respects RLS: each subscriber only receives change events for rows
-- their policies allow them to SELECT. So the manager sees new PIC requests
-- live, PICs see cost prices appear live, and drivers see delivery updates —
-- each within their own permission bubble.
-- ============================================================================

alter publication supabase_realtime add table public.order_cycles;
alter publication supabase_realtime add table public.store_requests;
alter publication supabase_realtime add table public.request_items;
alter publication supabase_realtime add table public.deliveries;
alter publication supabase_realtime add table public.delivery_item_checks;
