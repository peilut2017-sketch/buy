-- SmartBuy initial schema (draft). Review against docs/01-product-spec.md before running.
-- Conventions: snake_case, timestamptz in UTC, money as numeric(10,2) in ILS unless currency says otherwise.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  quiet_mode boolean not null default false,
  quiet_hours jsonb,                         -- {"from":"22:00","to":"08:00"}
  shabbat_mode boolean not null default false,
  shabbat_city text,                         -- for candle-lighting / havdalah times
  daily_notification_cap smallint not null default 3 check (daily_notification_cap between 0 and 20),
  show_listing_stars boolean not null default true,
  order_check_consent boolean not null default false,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

create table public.reviewer_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reviews_count integer not null default 0,
  verified_count integer not null default 0,
  helpful_received integer not null default 0,
  level text not null default 'new' check (level in ('new', 'active', 'experienced', 'leading')),
  reports_filed integer not null default 0,
  reports_dismissed integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.size_profiles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  garment_type text not null,                -- 'tops' | 'bottoms' | 'shoes' | ...
  brand text not null default '',            -- '' = all brands
  size text not null,
  primary key (user_id, garment_type, brand)
);

-- ---------------------------------------------------------------------------
-- Sites and catalogue
-- ---------------------------------------------------------------------------

create table public.sites (
  id text primary key,                       -- 'terminalx'
  name text not null,
  status text not null default 'beta' check (status in ('active', 'beta', 'paused')),
  domains text[] not null,
  adapter_config jsonb not null default '{}'::jsonb,  -- detection rules, selectors, email domains
  adapter_version integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.products (
  id bigint generated always as identity primary key,
  site_id text not null references public.sites(id),
  parent_sku text not null,
  name text,
  brand text,
  image_url text,
  category text,
  product_type text,                         -- drives category_questions, e.g. 'apparel'
  url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (site_id, parent_sku)
);

create table public.variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  sku text not null,
  attributes jsonb not null default '{}'::jsonb,   -- {"צבע":"כחול כהה","מידה":"M"}
  unique (product_id, sku)
);

create table public.global_products (
  id bigint generated always as identity primary key,
  gtin text,
  mpn text,
  brand text,
  normalized_name text,
  created_at timestamptz not null default now()
);

create table public.product_links (
  product_id bigint primary key references public.products(id) on delete cascade,
  global_product_id bigint not null references public.global_products(id) on delete cascade,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  source text not null check (source in ('gtin', 'mpn', 'name', 'community', 'admin')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.category_questions (
  product_type text not null,
  question_key text not null,                -- 'fit' | 'matches_photo' | 'value' | 'recommend' | 'usual_size'
  label text not null,
  kind text not null check (kind in ('choice', 'scale', 'boolean', 'size')),
  options jsonb,
  required boolean not null default false,
  sort smallint not null default 0,
  primary key (product_type, question_key)
);

-- ---------------------------------------------------------------------------
-- Orders and verification
-- ---------------------------------------------------------------------------

create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id text not null references public.sites(id),
  order_hash text not null,                  -- sha256(site_id || ':' || order_number || pepper)
  ordered_at date,
  delivered_at date,
  source text not null check (source in ('extension', 'email', 'order_lookup')),
  created_at timestamptz not null default now(),
  unique (site_id, order_hash)               -- one order locks to one account
);

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id),
  variant_id bigint references public.variants(id),
  sku text not null
);

create table public.pending_reviews (
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_item_id bigint not null references public.order_items(id) on delete cascade,
  product_id bigint not null references public.products(id),
  due_at timestamptz not null,               -- delivered_at + 14 days
  dismissed boolean not null default false,
  primary key (user_id, order_item_id)
);

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

create table public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id bigint not null references public.products(id),
  variant_id bigint references public.variants(id),
  variant_values jsonb not null default '{}'::jsonb,
  rating smallint not null check (rating between 1 and 5),
  title text check (char_length(title) <= 80),
  body text check (body is null or char_length(body) between 30 and 2000),  -- null = quick rating, unpublished
  answers jsonb not null default '{}'::jsonb,                                -- {"fit":"small","matches_photo":"yes",...}
  verification text not null default 'unverified' check (verification in ('verified', 'pending', 'unverified')),
  order_item_id bigint references public.order_items(id),
  purchase_month date,                       -- unverified: first day of month declared by author
  purchased_at date,                         -- verified: from order
  delivered_at date,                         -- verified, when known
  written_at timestamptz not null default now(),
  edited_at timestamptz,
  status text not null default 'visible' check (status in ('draft', 'visible', 'hidden', 'removed')),
  status_reason text,
  detection_confidence text check (detection_confidence in ('high', 'medium', 'low')),
  unique (user_id, product_id)
);

-- Days between purchase (or delivery) and writing, and the stage label shown in the UI.
create or replace function public.review_stage(r public.reviews)
returns text language sql immutable as $$
  select case
    when coalesce(r.delivered_at, r.purchased_at, r.purchase_month) is null then null
    when r.written_at::date - coalesce(r.delivered_at, r.purchased_at, r.purchase_month) <= 7 then 'first_impression'
    when r.written_at::date - coalesce(r.delivered_at, r.purchased_at, r.purchase_month) <= 90 then 'after_use'
    else 'long_term'
  end
$$;

create table public.review_updates (
  id bigint generated always as identity primary key,
  review_id bigint not null references public.reviews(id) on delete cascade,
  body text not null check (char_length(body) between 10 and 2000),
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create table public.helpful_votes (
  review_id bigint not null references public.reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table public.reports (
  id bigint generated always as identity primary key,
  review_id bigint not null references public.reviews(id) on delete cascade,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('spam', 'off_topic', 'offensive', 'personal_or_defamation', 'fake', 'other')),
  details text check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);

create table public.appeals (
  id bigint generated always as identity primary key,
  review_id bigint not null references public.reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 1000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id)                         -- one appeal per review
);

create table public.takedown_requests (
  id bigint generated always as identity primary key,
  review_id bigint references public.reviews(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Prices, watches, notifications
-- ---------------------------------------------------------------------------

create table public.price_events (
  id bigint generated always as identity primary key,
  variant_id bigint not null references public.variants(id) on delete cascade,
  price numeric(10, 2),
  currency text not null default 'ILS',
  in_stock boolean,
  observed_at timestamptz not null default now(),
  source text not null check (source in ('user_report', 'scrape')),
  install_hash text                          -- anonymous install id hash, never a user id
);
create index price_events_variant_time on public.price_events (variant_id, observed_at desc);

create table public.watches (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id bigint not null references public.products(id),
  variant_id bigint references public.variants(id),
  target_price numeric(10, 2),
  drop_percent smallint check (drop_percent between 1 and 90),
  notify_restock boolean not null default false,
  restock_variant_values jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (target_price is not null or drop_percent is not null or notify_restock)
);

create table public.notification_channels (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('extension', 'telegram', 'email', 'webpush')),
  address text,                              -- telegram chat id, email, push endpoint
  verified boolean not null default false,
  enabled boolean not null default true,
  primary key (user_id, channel)
);

create table public.notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('price_target', 'price_drop', 'restock', 'new_review_on_watch',
                                     'my_review_activity', 'moderation_decision', 'weekly_digest',
                                     'pending_review_reminder', 'durability_reminder')),
  channels text[] not null default '{extension}',
  enabled boolean not null default true,
  primary key (user_id, kind)
);

create table public.notification_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  dedupe_key text,
  created_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sent', 'merged', 'skipped', 'failed')),
  unique (user_id, dedupe_key)
);

create table public.notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null,
  kind text not null,
  payload jsonb,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now(),
  clicked_at timestamptz
);

create table public.telegram_link_tokens (
  token text primary key default encode(gen_random_bytes(16), 'hex'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- ---------------------------------------------------------------------------
-- Analytics, admin
-- ---------------------------------------------------------------------------

create table public.events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event text not null,                       -- 'install' | 'product_view' | 'panel_open' | 'signup' | 'review_submitted' | 'watch_created' | 'notification_click' | 'detect_failed' | 'uninstall'
  platform text not null check (platform in ('extension', 'web_desktop', 'web_mobile', 'server')),
  site_id text references public.sites(id),
  product_id bigint references public.products(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  install_id text,
  props jsonb not null default '{}'::jsonb
);
create index events_time on public.events (occurred_at desc);
create index events_event_time on public.events (event, occurred_at desc);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table public.settings (
  key text primary key,                      -- 'level_thresholds', 'review_limits', 'notification_cap', feature flags
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Read model for the strip and panel
-- ---------------------------------------------------------------------------

create or replace view public.product_summary as
select
  p.id as product_id,
  count(r.id) filter (where r.status = 'visible' and r.body is not null) as reviews_count,
  count(r.id) filter (where r.status = 'visible' and r.body is not null and r.verification = 'verified') as verified_count,
  round(avg(r.rating) filter (where r.status = 'visible' and r.body is not null), 1) as rating_avg,
  count(r.id) filter (where r.status = 'visible' and r.answers->>'fit' = 'small') as fit_small,
  count(r.id) filter (where r.status = 'visible' and r.answers->>'fit' = 'true') as fit_true,
  count(r.id) filter (where r.status = 'visible' and r.answers->>'fit' = 'large') as fit_large
from public.products p
left join public.reviews r on r.product_id = p.id
group by p.id;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(roles))
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','reviewer_stats','size_profiles','sites','products','variants','global_products',
    'product_links','category_questions','orders','order_items','pending_reviews','reviews',
    'review_updates','helpful_votes','reports','appeals','takedown_requests','price_events','watches',
    'notification_channels','notification_prefs','notification_queue','notification_log',
    'telegram_link_tokens','events','admin_audit_log','settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Public catalogue and reviews
create policy "public read sites" on public.sites for select using (status in ('active', 'beta'));
create policy "public read products" on public.products for select using (true);
create policy "public read variants" on public.variants for select using (true);
create policy "public read links" on public.product_links for select using (confirmed or confidence = 'high');
create policy "public read questions" on public.category_questions for select using (true);
create policy "public read reviewer stats" on public.reviewer_stats for select using (true);
create policy "public read visible reviews" on public.reviews for select
  using ((status = 'visible' and body is not null) or user_id = auth.uid() or public.has_role(array['moderator','admin']));
create policy "public read updates of visible reviews" on public.review_updates for select
  using (exists (select 1 from public.reviews r where r.id = review_id and r.status = 'visible'));
create policy "public read price events" on public.price_events for select using (true);
create policy "public read display names" on public.profiles for select using (true);
-- NOTE: expose only display_name publicly via a view or column grants before launch.

-- Own data
create policy "own profile update" on public.profiles for update using (id = auth.uid());
create policy "own size profile" on public.size_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own watches" on public.watches for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own channels read" on public.notification_channels for select using (user_id = auth.uid());
create policy "own channels toggle" on public.notification_channels for update using (user_id = auth.uid());
create policy "own prefs" on public.notification_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own pending reviews read" on public.pending_reviews for select using (user_id = auth.uid());
create policy "own pending reviews dismiss" on public.pending_reviews for update using (user_id = auth.uid());
create policy "own notification log" on public.notification_log for select using (user_id = auth.uid());
create policy "own orders read" on public.orders for select using (user_id = auth.uid());
create policy "own review delete" on public.reviews for delete using (user_id = auth.uid());
create policy "helpful vote" on public.helpful_votes for insert
  with check (user_id = auth.uid() and not exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));
create policy "helpful unvote" on public.helpful_votes for delete using (user_id = auth.uid());
create policy "helpful read" on public.helpful_votes for select using (true);

-- Moderation and admin
create policy "mods read reports" on public.reports for select using (public.has_role(array['moderator','admin']) or reporter_id = auth.uid());
create policy "mods decide reports" on public.reports for update using (public.has_role(array['moderator','admin']));
create policy "mods read appeals" on public.appeals for select using (public.has_role(array['moderator','admin']) or user_id = auth.uid());
create policy "mods read takedowns" on public.takedown_requests for select using (public.has_role(array['moderator','admin']));
create policy "admin sites" on public.sites for all using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy "admin settings" on public.settings for all using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy "admin events" on public.events for select using (public.has_role(array['admin']));
create policy "admin audit" on public.admin_audit_log for select using (public.has_role(array['admin']));

-- Writes to reviews, reports, appeals, orders, price_events, events, notification_* and
-- telegram_link_tokens go through Edge Functions with the service role, which validate
-- input, rate-limit, and write the audit log. No direct insert policies on purpose.

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

insert into public.sites (id, name, status, domains) values
  ('terminalx', 'Terminal X', 'beta', array['www.terminalx.com', 'terminalx.com']);

insert into public.category_questions (product_type, question_key, label, kind, options, required, sort) values
  ('apparel', 'fit', 'איך המידה?', 'choice', '["small","true","large"]', true, 1),
  ('apparel', 'usual_size', 'המידה הרגילה שלי', 'size', null, false, 2),
  ('apparel', 'matches_photo', 'תואם לתמונה?', 'choice', '["yes","roughly","no"]', false, 3),
  ('apparel', 'value', 'איכות ביחס למחיר', 'scale', '{"min":1,"max":5}', false, 4),
  ('apparel', 'recommend', 'ממליץ לקנות?', 'boolean', null, false, 5);

insert into public.settings (key, value) values
  ('level_thresholds', '{"active":3,"experienced":{"reviews":10,"helpful":10},"leading":{"reviews":25,"helpful":50,"verified_ratio":0.6}}'),
  ('review_limits', '{"per_day":5,"min_chars":30,"max_chars":2000,"count_after_hours":48}'),
  ('auto_hide', '{"reports":3,"min_reporter_level":"active","instant_reasons":["personal_or_defamation"]}'),
  ('notifications', '{"daily_cap":3,"pending_reminder_days":7,"pending_after_delivery_days":14,"durability_after_days":90}');
