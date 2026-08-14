-- ============================================================================
-- 0007_seed.sql — demo catalog, vendors and stores
--
-- USERS ARE NOT SEEDED HERE: auth users must be created through the Auth
-- admin API (they need password hashes + identities). Run `npm run seed`
-- (scripts/seed.mjs, uses the service-role key locally) AFTER this migration
-- to create: 1 superadmin, 1 manager, 2 PICs, 1 driver — and wire them to
-- the two stores below.
-- ============================================================================

-- 15 catalog items
insert into public.items (name, default_unit, emoji) values
  ('Tomato',       'kg',    '🍅'),
  ('Cucumber',     'kg',    '🥒'),
  ('Potato',       'bag',   '🥔'),
  ('Onion',        'bag',   '🧅'),
  ('Carrot',       'kg',    '🥕'),
  ('Lettuce',      'box',   '🥬'),
  ('Cabbage',      'piece', '🥬'),
  ('Bell Pepper',  'kg',    '🫑'),
  ('Chili Pepper', 'kg',    '🌶️'),
  ('Eggplant',     'kg',    '🍆'),
  ('Zucchini',     'kg',    '🥒'),
  ('Garlic',       'kg',    '🧄'),
  ('Ginger',       'kg',    '🫚'),
  ('Lemon',        'box',   '🍋'),
  ('Coriander',    'bunch', '🌿')
on conflict (name) do nothing;

-- 3 market vendors (numbers are placeholders — international format, digits only)
insert into public.vendors (name, whatsapp_number, notes) values
  ('Abu Khalid Vegetables', '966500000001', 'Tomatoes, cucumbers, peppers — best prices before 6am'),
  ('Al-Madina Produce',     '966500000002', 'Root vegetables and onions in bulk'),
  ('Green Valley Farms',    '966500000003', 'Leafy greens and herbs — ask for morning stock');

-- 2 stores (PICs get wired by scripts/seed.mjs)
insert into public.stores (name, address) values
  ('Store A — Main Street',   'Main Street, next to the bakery'),
  ('Store B — South Market',  'South Market road, opposite the mosque');
