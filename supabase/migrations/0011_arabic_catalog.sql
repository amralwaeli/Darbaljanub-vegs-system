-- ============================================================================
-- 0011_arabic_catalog.sql — repair mojibake, Arabic names, drop item icons
--
-- WHY: the 0007 seed was executed through a client that sent the file as
-- Windows-1252 instead of UTF-8, so every non-ASCII character was stored
-- double-encoded. The database really contains 'Store A â€" Main Street' and
-- emoji 'ðŸ…' — the app was faithfully rendering corrupt rows, it was never a
-- display bug. (Proof: 'طماطم', added later through the app, is stored
-- correctly, so the app's write path is fine.)
--
-- This migration rewrites those rows in Arabic and drops item icons entirely:
-- the catalogue is Arabic-only, and lists show just the name and the quantity.
--
-- Apply this in the Supabase SQL editor (a browser always posts UTF-8). Do NOT
-- pipe this file through psql on Windows without `-f` + a UTF-8 client
-- encoding, or you will reintroduce exactly the corruption it repairs.
-- ============================================================================

-- The catalogue is Arabic, so a PIC's pending 'طماطم' proposal is the same item
-- as the seeded 'Tomato' that is about to take that name. Drop the duplicate
-- first so the rename below cannot hit the unique index on items.name.
-- (request_items.item_id is ON DELETE RESTRICT, so this is a no-op if any
-- store request already references it.)
delete from public.items
where name = 'طماطم'
  and is_approved = false
  and not exists (
    select 1 from public.request_items ri where ri.item_id = items.id
  );

-- ------------------------------------------------------- Arabic catalogue ---
update public.items set name = 'طماطم'      where name = 'Tomato';
update public.items set name = 'خيار'        where name = 'Cucumber';
update public.items set name = 'بطاطس'      where name = 'Potato';
update public.items set name = 'بصل'         where name = 'Onion';
update public.items set name = 'جزر'         where name = 'Carrot';
update public.items set name = 'خس'          where name = 'Lettuce';
update public.items set name = 'ملفوف'      where name = 'Cabbage';
update public.items set name = 'فلفل رومي'  where name = 'Bell Pepper';
update public.items set name = 'فلفل حار'   where name = 'Chili Pepper';
update public.items set name = 'باذنجان'    where name = 'Eggplant';
update public.items set name = 'كوسا'        where name = 'Zucchini';
update public.items set name = 'ثوم'         where name = 'Garlic';
update public.items set name = 'زنجبيل'     where name = 'Ginger';
update public.items set name = 'ليمون'      where name = 'Lemon';
update public.items set name = 'كزبرة'      where name = 'Coriander';

-- No item icons anywhere: every stored emoji was mojibake, and the UI no
-- longer renders them.
update public.items set emoji = null where emoji is not null;

-- ---------------------------------------------------------- store names -----
-- These held the corrupted em-dash ('â€"').
update public.stores
set name = 'محل الشارع الرئيسي',
    address = 'الشارع الرئيسي، بجانب المخبز'
where name like 'Store A%';

update public.stores
set name = 'محل السوق الجنوبي',
    address = 'طريق السوق الجنوبي، مقابل المسجد'
where name like 'Store B%';

-- --------------------------------------------------------------- safety -----
-- Catch any other row still carrying the tell-tale double-encoding sequence,
-- so it is visible instead of silently living on.
do $$
declare
  bad int;
begin
  select count(*) into bad
  from public.items
  where name like '%Ã%' or name like '%â€%' or name like '%ðŸ%';
  if bad > 0 then
    raise warning 'items still containing mojibake: %', bad;
  end if;
end $$;
