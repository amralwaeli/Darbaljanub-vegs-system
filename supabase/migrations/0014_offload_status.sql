-- ============================================================================
-- 0014_offload_status.sql — add the OFFLOADED delivery state
--
-- DELIBERATELY ITS OWN FILE. Postgres will not let a newly added enum value be
-- referenced by DDL in the same transaction ("unsafe use of new value of enum
-- type"), and 0015 uses 'OFFLOADED' in a trigger WHEN clause. Run this file
-- first, let it commit, then run 0015.
--
-- New delivery lifecycle:
--   PENDING --(driver: photo + all items ticked)--> LOADED
--   LOADED  --(driver at the branch: offload photo)--> OFFLOADED
--   OFFLOADED --(PIC or manager)--> RECEIVED
--
-- The driver now proves both ends of the trip: what left the market, and what
-- was handed over at the shop. The store still confirms receipt separately —
-- two parties, two records.
-- ============================================================================

alter type public.delivery_status add value if not exists 'OFFLOADED' after 'LOADED';
