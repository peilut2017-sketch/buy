-- SmartBuy initial schema.
-- Source of truth for behaviour: docs/01-product-spec.md. Data model notes: docs/04-data-model.md.
-- Conventions: snake_case, timestamptz in UTC, money as numeric(10,2) in ILS unless currency says otherwise.
--
-- Access model (least privilege):
--   * anon / authenticated get NO table privileges by default. Section "Grants" at the end lists every
--     privilege they have, and RLS policies narrow it further.
--   * Anything that needs validation, rate limiting or an audit trail (submit review, report, verify order,
--     price reports, events, notifications, role changes, moderation decisions) is written by Edge
--     Functions with the service role, never directly by clients.
--   * Every future migration must repeat this pattern: enable RLS, add policies, grant explicitly.
--     Supabase grants new public tables to anon/authenticated by default; do not rely on that.

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 2 and 30),  -- null until the user picks a nickname; the real Google name is never copied
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  quiet_mode boolean not null default false,
  quiet_hours jsonb,                         -- {"from":"22:00","to":"08:00"}
  shabbat_mode boolean not null default false,
  shabbat_city text,                         -- for candle-lighting / havdalah times
  daily_notification_cap smallint not null default 3 check (daily_notification_cap between 0 and 20),
  show_listing_stars boolean not null default true,
  order_check_consent boolean not null default false,
  blocked_at timestamptz,                    -- set by an admin through an Edge Function; blocked users cannot write
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

-- Nicknames are unique regardless of case, so nobody can pose as a leading reviewer ("Dana" vs "dana").
create unique index profiles_display_name_unique on public.profiles (lower(display_name));

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
  adapter_config jsonb not null default '{}'::jsonb,  -- detection rules, selectors, email domains. Data only, never code.
  adapter_version integer not null default 1,         -- bumped automatically when adapter_config changes
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
  options jsonb,                             -- choice: [{"value":"small","label":"קטן"}, ...]; scale: {"min":1,"max":5}
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
  order_hash text not null,                  -- sha256(site_id || ':' || order_number || pepper), computed in the Edge Function
  ordered_at date,
  delivered_at date,
  source text not null check (source in ('extension', 'email', 'order_lookup')),
  created_at timestamptz not null default now(),
  unique (site_id, order_hash)               -- one order locks to one account
);
create index orders_user on public.orders (user_id);

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id),
  variant_id bigint references public.variants(id),
  sku text not null
);
create index order_items_order on public.order_items (order_id);

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
  body text check (body is null or char_length(body) between 30 and 2000),  -- null = quick rating, never published
  answers jsonb not null default '{}'::jsonb,                                -- {"fit":"small","matches_photo":"yes",...}
  verification text not null default 'unverified' check (verification in ('verified', 'pending', 'unverified')),
  order_item_id bigint references public.order_items(id),
  purchase_month date,                       -- unverified/pending: first day of the month declared by the author
  purchased_at date,                         -- verified: from the order
  delivered_at date,                         -- verified, when known
  written_at timestamptz not null default now(),
  edited_at timestamptz,
  status text not null default 'visible' check (status in ('draft', 'visible', 'hidden', 'removed')),
  status_reason text,
  detection_confidence text check (detection_confidence in ('high', 'medium', 'low')),
  helpful_count integer not null default 0,  -- maintained by trigger on helpful_votes
  unique (user_id, product_id),
  check (verification <> 'verified' or order_item_id is not null),
  check (purchase_month is null or purchase_month = date_trunc('month', purchase_month)::date),
  check (body is null or verification = 'verified' or purchase_month is not null),  -- spec 6: month of purchase is required unless verified
  check (answers->>'fit' is null or answers->>'fit' in ('small', 'exact', 'large'))
);
create index reviews_product_visible on public.reviews (product_id, written_at desc)
  where status = 'visible' and body is not null;

-- Stage label shown next to a review, from the time between delivery (or purchase) and writing.
create or replace function public.review_stage(r public.reviews)
returns text language sql immutable as $$
  select case
    when ref.d is null then null
    when (r.written_at at time zone 'UTC')::date - ref.d <= 7 then 'first_impression'
    when (r.written_at at time zone 'UTC')::date - ref.d <= 90 then 'after_use'
    else 'long_term'
  end
  from (select coalesce(r.delivered_at, r.purchased_at, r.purchase_month) as d) ref
$$;

create table public.review_updates (
  id bigint generated always as identity primary key,
  review_id bigint not null references public.reviews(id) on delete cascade,
  body text not null check (char_length(body) between 10 and 2000),
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now()
);
create index review_updates_review on public.review_updates (review_id);

create table public.helpful_votes (
  review_id bigint not null references public.reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);
create index helpful_votes_user on public.helpful_votes (user_id);

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
create index reports_review on public.reports (review_id);
create index reports_open on public.reports (created_at) where status = 'open';

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

-- Automatic suspicion flags (spec 6 sanity check, spec 11 review waves). Moderators only; never shown to authors.
-- Phase 3 adds more reasons by extending the check.
create table public.review_flags (
  id bigint generated always as identity primary key,
  review_id bigint not null references public.reviews(id) on delete cascade,
  reason text not null check (reason in ('written_before_delivery', 'review_wave', 'manual')),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  unique (review_id, reason)
);

-- ---------------------------------------------------------------------------
-- Prices, watches, notifications
-- ---------------------------------------------------------------------------

-- Written only by Edge Functions. Clients read it through the price_history view, which omits install_hash.
create table public.price_events (
  id bigint generated always as identity primary key,
  variant_id bigint not null references public.variants(id) on delete cascade,
  price numeric(10, 2),
  currency text not null default 'ILS',
  in_stock boolean,
  observed_at timestamptz not null default now(),
  source text not null check (source in ('user_report', 'scrape')),
  install_hash text                          -- anonymous install id hash, for rate limiting and outliers only; never a user id
);
create index price_events_variant_time on public.price_events (variant_id, observed_at desc);

create table public.watches (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id bigint not null references public.products(id),
  variant_id bigint references public.variants(id),
  target_price numeric(10, 2) check (target_price > 0),
  drop_percent smallint check (drop_percent between 1 and 90),
  notify_restock boolean not null default false,
  restock_variant_values jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (target_price is not null or drop_percent is not null or notify_restock)
);
create unique index watches_one_per_target on public.watches (user_id, product_id, coalesce(variant_id, 0));

create table public.notification_channels (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('extension', 'telegram', 'email', 'webpush')),
  address text,                              -- telegram chat id, email, push endpoint. Written by Edge Functions only.
  verified boolean not null default false,
  enabled boolean not null default true,
  primary key (user_id, channel)
);

create table public.notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('price_target', 'price_drop', 'restock', 'new_review_on_watch',
                                     'my_review_activity', 'moderation_decision', 'weekly_digest',
                                     'pending_review_reminder', 'durability_reminder')),
  channels text[] not null default '{extension}'
    check (channels <@ array['extension', 'telegram', 'email', 'webpush']),
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
create index notification_queue_pending on public.notification_queue (created_at) where status = 'queued';

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
create index notification_log_user_time on public.notification_log (user_id, sent_at desc);

create table public.telegram_link_tokens (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),   -- 32 hex chars, fits Telegram's /start payload
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- ---------------------------------------------------------------------------
-- Analytics, admin
-- ---------------------------------------------------------------------------

create table public.events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event text not null check (event in ('install', 'first_product_view', 'product_view', 'panel_open', 'signup',
                                       'review_submitted', 'watch_created', 'notification_click', 'detect_failed',
                                       'uninstall')),
  platform text not null check (platform in ('extension', 'web_desktop', 'web_mobile', 'server')),
  site_id text references public.sites(id),
  product_id bigint references public.products(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  install_id text,
  props jsonb not null default '{}'::jsonb,
  -- Privacy rule 7: no browsing history. A product view may name the product but never who looked at it.
  -- The funnel uses first_product_view (once per install, no product) instead.
  constraint events_no_browsing_history check (event <> 'product_view' or (user_id is null and install_id is null))
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
  key text primary key,                      -- 'level_thresholds', 'review_limits', 'notifications', feature flags
  value jsonb not null,
  is_public boolean not null default true,   -- readable by the extension and website (thresholds, flags); false = admin only
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Read models for the strip, panel and review list
-- ---------------------------------------------------------------------------

-- security_invoker: the caller's RLS on reviews applies, and the filters below match the public policy.
create or replace view public.product_summary with (security_invoker = true) as
select
  p.id as product_id,
  count(r.id) filter (where r.status = 'visible' and r.body is not null) as reviews_count,
  count(r.id) filter (where r.status = 'visible' and r.body is not null and r.verification = 'verified') as verified_count,
  round(avg(r.rating) filter (where r.status = 'visible' and r.body is not null), 1) as rating_avg,
  count(r.id) filter (where r.status = 'visible' and r.body is not null and r.answers->>'fit' = 'small') as fit_small,
  count(r.id) filter (where r.status = 'visible' and r.body is not null and r.answers->>'fit' = 'exact') as fit_exact,
  count(r.id) filter (where r.status = 'visible' and r.body is not null and r.answers->>'fit' = 'large') as fit_large
from public.products p
left join public.reviews r on r.product_id = p.id
group by p.id;

-- The only public face of a user: nickname, level and counters. Runs with the owner's rights on purpose,
-- because profiles and reviewer_stats are private. Never add columns here without a privacy review.
create or replace view public.reviewer_public with (security_invoker = false) as
select p.id as user_id, p.display_name, s.level, s.reviews_count, s.verified_count, s.helpful_received
from public.profiles p
join public.reviewer_stats s on s.user_id = p.id
where p.display_name is not null;

-- Price history without install_hash. Runs with the owner's rights because price_events is not readable by clients.
create or replace view public.price_history with (security_invoker = false) as
select id, variant_id, price, currency, in_stock, observed_at, source
from public.price_events;

-- ---------------------------------------------------------------------------
-- Functions and triggers
-- ---------------------------------------------------------------------------

create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(roles) and blocked_at is null)
$$;

-- New account: profile (no nickname yet), stats row, extension channel, default notification preferences.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.reviewer_stats (user_id) values (new.id);
  insert into public.notification_channels (user_id, channel, verified) values (new.id, 'extension', true);
  insert into public.notification_prefs (user_id, kind, enabled) values
    (new.id, 'price_target', true),
    (new.id, 'price_drop', false),
    (new.id, 'restock', true),
    (new.id, 'new_review_on_watch', false),
    (new.id, 'my_review_activity', false),
    (new.id, 'moderation_decision', true),
    (new.id, 'weekly_digest', false),
    (new.id, 'pending_review_reminder', true),
    (new.id, 'durability_reminder', true);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keeps reviews.helpful_count in step with helpful_votes (self-votes are blocked by the insert policy).
create or replace function public.sync_helpful_count()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.reviews set helpful_count = helpful_count + 1 where id = new.review_id;
  else
    update public.reviews set helpful_count = greatest(helpful_count - 1, 0) where id = old.review_id;
  end if;
  return null;
end $$;

create trigger helpful_votes_count
  after insert or delete on public.helpful_votes
  for each row execute function public.sync_helpful_count();

-- Reviewer levels (spec 9). Thresholds come from settings.level_thresholds, so admins can tune them without a deploy.
-- A review counts only after review_limits.count_after_hours and while it is visible. Called with no argument by a
-- scheduled job (reviews cross the delay on their own) and with a user id after a review, vote or report changes.
create or replace function public.recompute_reviewer_stats(p_user uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  th jsonb := (select value from public.settings where key = 'level_thresholds');
  hold interval := make_interval(hours => coalesce(
    (select (value->>'count_after_hours')::int from public.settings where key = 'review_limits'), 48));
begin
  insert into public.reviewer_stats as s
    (user_id, reviews_count, verified_count, helpful_received, level, reports_filed, reports_dismissed, updated_at)
  select
    p.id,
    coalesce(r.n, 0), coalesce(r.v, 0), coalesce(r.h, 0),
    case
      when coalesce(r.n, 0) >= (th #>> '{leading,reviews}')::int
       and coalesce(r.h, 0) >= (th #>> '{leading,helpful}')::int
       and coalesce(r.v, 0) >= (th #>> '{leading,verified_ratio}')::numeric * coalesce(r.n, 0) then 'leading'
      when coalesce(r.n, 0) >= (th #>> '{experienced,reviews}')::int
       and coalesce(r.h, 0) >= (th #>> '{experienced,helpful}')::int then 'experienced'
      when coalesce(r.n, 0) >= (th ->> 'active')::int then 'active'
      else 'new'
    end,
    coalesce(rp.filed, 0), coalesce(rp.dismissed, 0), now()
  from public.profiles p
  left join (
    select user_id, count(*) as n, count(*) filter (where verification = 'verified') as v,
           coalesce(sum(helpful_count), 0) as h
    from public.reviews
    where status = 'visible' and body is not null and written_at <= now() - hold
    group by user_id
  ) r on r.user_id = p.id
  left join (
    select reporter_id, count(*) as filed, count(*) filter (where status = 'dismissed') as dismissed
    from public.reports group by reporter_id
  ) rp on rp.reporter_id = p.id
  where p_user is null or p.id = p_user
  on conflict (user_id) do update set
    reviews_count = excluded.reviews_count, verified_count = excluded.verified_count,
    helpful_received = excluded.helpful_received, level = excluded.level,
    reports_filed = excluded.reports_filed, reports_dismissed = excluded.reports_dismissed,
    updated_at = excluded.updated_at;
end $$;

-- Clients that read adapter_config cache it by adapter_version, so a config edit must always change the version.
create or replace function public.bump_adapter_version()
returns trigger language plpgsql as $$
begin
  if new.adapter_config is distinct from old.adapter_config then
    new.adapter_version := old.adapter_version + 1;
  end if;
  return new;
end $$;

create trigger sites_bump_adapter_version
  before update on public.sites
  for each row execute function public.bump_adapter_version();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger settings_touch
  before update on public.settings
  for each row execute function public.touch_updated_at();

-- Admins may edit sites and settings straight from the admin site; this keeps those edits in the audit log.
-- Calls without a user (service role, migrations) are not admin-UI actions and are not logged here.
create or replace function public.audit_admin_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  row_new jsonb := to_jsonb(new);
  row_old jsonb := to_jsonb(old);
begin
  if actor is null then
    return null;
  end if;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (actor, lower(tg_op), tg_table_name, coalesce(row_new, row_old) ->> tg_argv[0],
          jsonb_build_object('old', row_old, 'new', row_new));
  return null;
end $$;

create trigger sites_audit
  after insert or update or delete on public.sites
  for each row execute function public.audit_admin_change('id');

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_admin_change('key');

-- Internal functions are not callable through the API. has_role and review_stage stay executable: policies and
-- computed columns call them with the caller's rights.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_helpful_count() from public, anon, authenticated;
revoke execute on function public.recompute_reviewer_stats(uuid) from public, anon, authenticated;
revoke execute on function public.bump_adapter_version() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_admin_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','reviewer_stats','size_profiles','sites','products','variants','global_products',
    'product_links','category_questions','orders','order_items','pending_reviews','reviews',
    'review_updates','helpful_votes','reports','appeals','takedown_requests','review_flags','price_events',
    'watches','notification_channels','notification_prefs','notification_queue','notification_log',
    'telegram_link_tokens','events','admin_audit_log','settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Users: private. Public identity goes through the reviewer_public view.
create policy "own profile read" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "staff read profiles" on public.profiles for select to authenticated
  using (public.has_role(array['moderator', 'admin']));
create policy "own profile update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Only the columns granted below can change; role and blocked_at are written by Edge Functions.

create policy "own stats read" on public.reviewer_stats for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(array['moderator', 'admin']));
create policy "own size profile" on public.size_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Catalogue. Paused sites stay readable so the extension can see the kill switch and stop.
create policy "public read sites" on public.sites for select to anon, authenticated using (true);
create policy "admin sites" on public.sites for all to authenticated
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy "public read products" on public.products for select to anon, authenticated using (true);
create policy "public read variants" on public.variants for select to anon, authenticated using (true);
create policy "public read global products" on public.global_products for select to anon, authenticated using (true);
-- Spec 18: only a low-confidence link is held back until someone confirms it.
create policy "public read links" on public.product_links for select to anon, authenticated
  using (confirmed or confidence <> 'low');
create policy "public read questions" on public.category_questions for select to anon, authenticated using (true);

-- Orders: a user sees their own. Written by the verification Edge Function.
create policy "own orders read" on public.orders for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own order items read" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
create policy "own pending reviews read" on public.pending_reviews for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own pending reviews dismiss" on public.pending_reviews for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Only pending_reviews.dismissed can change (column grant below).

-- Reviews: public ones are visible with text; authors see their own in any status; staff see all.
-- Create and edit go through submit-review. The only direct write is deleting your own review.
create policy "read reviews" on public.reviews for select to anon, authenticated
  using ((status = 'visible' and body is not null) or user_id = (select auth.uid())
         or public.has_role(array['moderator', 'admin']));
create policy "own review delete" on public.reviews for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "read review updates" on public.review_updates for select to anon, authenticated
  using (exists (
    select 1 from public.reviews r
    where r.id = review_id
      and ((r.status = 'visible' and r.body is not null) or r.user_id = (select auth.uid())
           or public.has_role(array['moderator', 'admin']))));

-- "Helpful": signed-in users, one vote each, never on your own review, only on public reviews.
create policy "own votes read" on public.helpful_votes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "helpful vote" on public.helpful_votes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.reviews r
                where r.id = review_id and r.user_id <> (select auth.uid())
                  and r.status = 'visible' and r.body is not null));
create policy "helpful unvote" on public.helpful_votes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Moderation. Reports, appeals and takedowns are created and decided by Edge Functions, so every decision is audited.
create policy "read reports" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.has_role(array['moderator', 'admin']));
create policy "read appeals" on public.appeals for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(array['moderator', 'admin']));
create policy "staff read takedowns" on public.takedown_requests for select to authenticated
  using (public.has_role(array['moderator', 'admin']));
create policy "staff read flags" on public.review_flags for select to authenticated
  using (public.has_role(array['moderator', 'admin']));

-- Prices: price_events has no client policy at all. Clients read price_history; Edge Functions write.
create policy "own watches" on public.watches for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Notifications. Channels are created by Edge Functions (Telegram linking, email); users can only switch them on or off.
create policy "own channels read" on public.notification_channels for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own channels toggle" on public.notification_channels for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own prefs" on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notification log" on public.notification_log for select to authenticated
  using (user_id = (select auth.uid()));
-- notification_queue and telegram_link_tokens: no policies, service role only.

-- Admin
create policy "admin events" on public.events for select to authenticated
  using (public.has_role(array['admin']));
create policy "admin audit" on public.admin_audit_log for select to authenticated
  using (public.has_role(array['admin']));
create policy "public read settings" on public.settings for select to anon, authenticated using (is_public);
create policy "admin settings" on public.settings for all to authenticated
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Public reads (RLS decides which rows)
grant select on public.sites, public.products, public.variants, public.global_products, public.product_links,
  public.category_questions, public.reviews, public.review_updates, public.settings
  to anon, authenticated;
grant select on public.product_summary, public.reviewer_public, public.price_history to anon, authenticated;

-- Signed-in reads of own data, and staff reads (RLS narrows both)
grant select on public.profiles, public.reviewer_stats, public.size_profiles, public.orders, public.order_items,
  public.pending_reviews, public.helpful_votes, public.reports, public.appeals, public.takedown_requests,
  public.review_flags, public.watches, public.notification_channels, public.notification_prefs,
  public.notification_log, public.events, public.admin_audit_log
  to authenticated;

-- Signed-in writes. Column lists are what keeps role, blocked_at, addresses and verification out of reach.
grant update (display_name, quiet_mode, quiet_hours, shabbat_mode, shabbat_city, daily_notification_cap,
              show_listing_stars, order_check_consent)
  on public.profiles to authenticated;
grant insert, update, delete on public.size_profiles, public.watches, public.notification_prefs to authenticated;
grant update (dismissed) on public.pending_reviews to authenticated;
grant update (enabled) on public.notification_channels to authenticated;
grant delete on public.reviews to authenticated;
grant insert, delete on public.helpful_votes to authenticated;
-- Admin-only by RLS; audited by trigger.
grant insert, update, delete on public.sites, public.settings to authenticated;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

-- adapter_config stays empty until phase 0 research fills it (docs/06-research-checklist.md).
insert into public.sites (id, name, status, domains) values
  ('terminalx', 'Terminal X', 'beta', array['www.terminalx.com', 'terminalx.com']);

-- Product types are set by the adapter. 'general' is the fallback with no size questions.
insert into public.category_questions (product_type, question_key, label, kind, options, required, sort)
select t.product_type, q.question_key, q.label, q.kind, q.options, q.required, q.sort
from (values ('apparel'), ('footwear')) as t(product_type)
cross join (values
  ('fit', 'איך המידה?', 'choice',
    '[{"value":"small","label":"קטן"},{"value":"exact","label":"מדויק"},{"value":"large","label":"גדול"}]'::jsonb, true, 1),
  ('usual_size', 'המידה הרגילה שלי', 'size', null::jsonb, false, 2),
  ('matches_photo', 'תואם לתמונה?', 'choice',
    '[{"value":"yes","label":"כן"},{"value":"roughly","label":"בערך"},{"value":"no","label":"לא"}]'::jsonb, false, 3),
  ('value', 'איכות ביחס למחיר', 'scale', '{"min":1,"max":5}'::jsonb, false, 4),
  ('recommend', 'ממליץ לקנות?', 'boolean', null::jsonb, false, 5)
) as q(question_key, label, kind, options, required, sort);

insert into public.category_questions (product_type, question_key, label, kind, options, required, sort) values
  ('general', 'matches_photo', 'תואם לתמונה?', 'choice',
    '[{"value":"yes","label":"כן"},{"value":"roughly","label":"בערך"},{"value":"no","label":"לא"}]', false, 1),
  ('general', 'value', 'איכות ביחס למחיר', 'scale', '{"min":1,"max":5}', false, 2),
  ('general', 'recommend', 'ממליץ לקנות?', 'boolean', null, false, 3);

insert into public.settings (key, value) values
  ('level_thresholds', '{"active":3,"experienced":{"reviews":10,"helpful":10},"leading":{"reviews":25,"helpful":50,"verified_ratio":0.6}}'),
  ('review_limits', '{"per_day":5,"min_chars":30,"max_chars":2000,"count_after_hours":48}'),
  ('auto_hide', '{"reports":3,"min_reporter_level":"active","instant_reasons":["personal_or_defamation"]}'),
  ('reporter_abuse', '{"dismissed_ratio":0.7,"min_reports":5}'),
  ('review_wave', '{"threshold":5,"window_hours":24}'),
  ('notifications', '{"daily_cap":3,"pending_reminder_days":7,"pending_after_delivery_days":14,"durability_after_days":90}');
