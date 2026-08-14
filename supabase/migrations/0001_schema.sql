-- ============================================================================
-- 0001_schema.sql — enums, tables, constraints, indexes
-- Paste into Supabase SQL editor FIRST (or run via supabase db push).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums ----
create type public.user_role      as enum ('superadmin', 'manager', 'pic', 'driver');
create type public.cycle_status   as enum ('OPEN', 'ORDERED', 'PURCHASED', 'IN_DELIVERY', 'COMPLETED');
create type public.request_status as enum ('DRAFT', 'SUBMITTED');
create type public.delivery_status as enum ('PENDING', 'LOADED', 'RECEIVED');

-- --------------------------------------------------------------- stores ----
-- pic_id FK added after profiles exists (circular reference).
create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  address    text check (char_length(address) <= 300),
  pic_id     uuid,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------- profiles ----
-- Single source of truth for role + store assignment. NEVER duplicated into
-- client-editable JWT claims.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text check (char_length(username) between 1 and 40),
  role          public.user_role not null default 'pic',
  store_id      uuid references public.stores (id) on delete set null,
  phone         text check (phone ~ '^[0-9+ -]{6,20}$'),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.stores
  add constraint stores_pic_fk
  foreign key (pic_id) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------- items ----
create table public.items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (char_length(name) between 1 and 60),
  default_unit text not null default 'kg' check (char_length(default_unit) between 1 and 12),
  emoji        text check (char_length(emoji) <= 8),
  is_active    boolean not null default true,
  -- PIC-proposed items arrive unapproved; Manager approves them.
  is_approved  boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -------------------------------------------------------------- vendors ----
create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  whatsapp_number text not null check (whatsapp_number ~ '^[0-9]{6,17}$'), -- digits only, intl format without +
  notes           text check (char_length(notes) <= 300),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- --------------------------------------------------------- order_cycles ----
create table public.order_cycles (
  id         uuid primary key default gen_random_uuid(),
  cycle_date date not null default current_date,
  status     public.cycle_status not null default 'OPEN',
  created_by uuid references public.profiles (id) on delete set null,
  locked_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Business rule: only ONE cycle may be in progress at any time.
create unique index order_cycles_single_active
  on public.order_cycles ((true))
  where status <> 'COMPLETED';

-- ------------------------------------------------------- store_requests ----
create table public.store_requests (
  id         uuid primary key default gen_random_uuid(),
  cycle_id   uuid not null references public.order_cycles (id) on delete cascade,
  store_id   uuid not null references public.stores (id) on delete cascade,
  status     public.request_status not null default 'SUBMITTED',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, store_id)                    -- one request per store per cycle
);

-- -------------------------------------------------------- request_items ----
create table public.request_items (
  id               uuid primary key default gen_random_uuid(),
  store_request_id uuid not null references public.store_requests (id) on delete cascade,
  item_id          uuid not null references public.items (id) on delete restrict,
  requested_qty    numeric(10,2) not null check (requested_qty > 0 and requested_qty <= 100000),
  unit             text not null check (char_length(unit) between 1 and 12),
  purchased_qty    numeric(10,2) check (purchased_qty >= 0 and purchased_qty <= 100000),
  unit_cost        numeric(12,2) check (unit_cost >= 0 and unit_cost <= 1000000),
  selling_price    numeric(12,2) check (selling_price >= 0 and selling_price <= 1000000),
  -- server-computed, never trusted from the client
  line_total       numeric(14,2) generated always as
                     (round(coalesce(purchased_qty, requested_qty) * unit_cost, 2)) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_request_id, item_id)             -- one line per item per store request
);

-- -------------------------------------------------------- vendor_orders ----
create table public.vendor_orders (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references public.order_cycles (id) on delete cascade,
  vendor_id        uuid not null references public.vendors (id) on delete restrict,
  message_snapshot text not null check (char_length(message_snapshot) <= 8000),
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

create table public.vendor_order_items (
  id              uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null references public.vendor_orders (id) on delete cascade,
  item_id         uuid not null references public.items (id) on delete restrict,
  total_qty       numeric(12,2) not null check (total_qty > 0),
  unit            text not null check (char_length(unit) between 1 and 12)
);

-- ----------------------------------------------------------- deliveries ----
create table public.deliveries (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    uuid not null references public.order_cycles (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete cascade,
  driver_id   uuid references public.profiles (id) on delete set null,
  status      public.delivery_status not null default 'PENDING',
  photo_path  text check (char_length(photo_path) <= 300),
  loaded_at   timestamptz,
  received_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (cycle_id, store_id)
);

create table public.delivery_item_checks (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     uuid not null references public.deliveries (id) on delete cascade,
  request_item_id uuid not null references public.request_items (id) on delete cascade,
  checked         boolean not null default false,
  updated_at      timestamptz not null default now(),
  unique (delivery_id, request_item_id)
);

-- ------------------------------------------------------------ audit_log ----
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,                                  -- auth.uid() of who did it
  action     text not null,                         -- INSERT / UPDATE / DELETE
  table_name text not null,
  record_id  text not null,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- login_attempts ----
-- Written ONLY by the auth-login Edge Function (service role). RLS: no policies
-- => invisible and unwritable to all client roles.
create table public.login_attempts (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text,
  success    boolean not null default false,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- indexes ----
-- Columns used by RLS predicates and hot queries.
create index profiles_store_idx        on public.profiles (store_id);
create index profiles_role_idx         on public.profiles (role);
create index stores_pic_idx            on public.stores (pic_id);
create index store_requests_cycle_idx  on public.store_requests (cycle_id);
create index store_requests_store_idx  on public.store_requests (store_id);
create index request_items_req_idx     on public.request_items (store_request_id);
create index request_items_item_idx    on public.request_items (item_id);
create index vendor_orders_cycle_idx   on public.vendor_orders (cycle_id);
create index vendor_order_items_vo_idx on public.vendor_order_items (vendor_order_id);
create index deliveries_cycle_idx      on public.deliveries (cycle_id);
create index deliveries_store_idx      on public.deliveries (store_id);
create index dic_delivery_idx          on public.delivery_item_checks (delivery_id);
create index audit_log_created_idx     on public.audit_log (created_at desc);
create index audit_log_record_idx      on public.audit_log (table_name, record_id);
create index login_attempts_email_idx  on public.login_attempts (email, created_at desc);
