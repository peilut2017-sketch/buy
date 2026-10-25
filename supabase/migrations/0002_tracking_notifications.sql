-- Phase 2: price tracking and notifications. Spec: docs/01-product-spec.md sections 13 and 14.
-- Same access model as 0001: new tables are service-role only unless a policy and grant below say otherwise.

-- ---------------------------------------------------------------------------
-- Notification log: the extension channel
-- ---------------------------------------------------------------------------

-- The extension shows its own notifications. The server logs them as "sent", and the extension picks them up by polling,
-- then marks them shown. A message is one merged batch; batch_id lives in payload and is what the daily cap counts.
alter table public.notification_log add column extension_shown_at timestamptz;
create index notification_log_extension_pending on public.notification_log (user_id)
  where channel = 'extension' and extension_shown_at is null;
create index notification_log_batch on public.notification_log (user_id, sent_at desc) where status = 'sent';

-- ---------------------------------------------------------------------------
-- Price reports: outliers need a second, independent report (architecture: "דיווחי מחיר")
-- ---------------------------------------------------------------------------

create table public.price_outlier_candidates (
  id bigint generated always as identity primary key,
  variant_id bigint not null references public.variants(id) on delete cascade,
  price numeric(10, 2) not null,
  in_stock boolean,
  install_hash text not null,
  observed_at timestamptz not null default now(),
  unique (variant_id, price, install_hash)
);
create index price_outlier_candidates_lookup on public.price_outlier_candidates (variant_id, price, observed_at desc);
alter table public.price_outlier_candidates enable row level security;
revoke all on public.price_outlier_candidates from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Watches: the target must be below the current price (spec 13)
-- ---------------------------------------------------------------------------

create or replace function public.check_watch_target()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare latest numeric(10, 2);
begin
  if new.target_price is null or new.variant_id is null then
    return new;
  end if;
  select price into latest from public.price_events
    where variant_id = new.variant_id and price is not null order by id desc limit 1;
  -- Without a known price there is nothing to compare with, so the target is accepted.
  if latest is not null and new.target_price >= latest then
    raise exception 'target_price_must_be_below_current' using errcode = '23514',
      detail = format('current price is %s', latest);
  end if;
  return new;
end $$;

create trigger watches_check_target
  before insert or update of target_price, variant_id on public.watches
  for each row execute function public.check_watch_target();

-- ---------------------------------------------------------------------------
-- Price and stock changes become queued notifications
-- ---------------------------------------------------------------------------

-- The queue holds what happened. Whether, when and where it is delivered (preferences, quiet hours, Shabbat, daily cap,
-- merging) is decided by the send-notifications function.
create or replace function public.enqueue_price_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prev record;
  info record;
  w record;
  base jsonb;
begin
  select price, in_stock into prev from public.price_events
    where variant_id = new.variant_id and id < new.id order by id desc limit 1;
  select v.product_id, v.sku, v.attributes, p.name, p.url into info
    from public.variants v join public.products p on p.id = v.product_id where v.id = new.variant_id;
  if info.product_id is null then
    return new;
  end if;

  for w in
    select * from public.watches
    where active and product_id = info.product_id and (variant_id is null or variant_id = new.variant_id)
  loop
    base := jsonb_build_object('watchId', w.id, 'productId', info.product_id, 'variantId', new.variant_id, 'name', info.name,
                               'url', info.url, 'sku', info.sku, 'attributes', info.attributes, 'currency', new.currency,
                               'price', new.price, 'previousPrice', prev.price);

    if w.target_price is not null and new.price is not null and new.price <= w.target_price
       and (prev.price is null or prev.price > w.target_price) then
      insert into public.notification_queue (user_id, kind, payload, dedupe_key)
      values (w.user_id, 'price_target', base || jsonb_build_object('targetPrice', w.target_price), format('pt:%s:%s', w.id, new.id))
      on conflict (user_id, dedupe_key) do nothing;
    end if;

    if w.drop_percent is not null and new.price is not null and prev.price is not null
       and new.price <= prev.price * (1 - w.drop_percent / 100.0) then
      insert into public.notification_queue (user_id, kind, payload, dedupe_key)
      values (w.user_id, 'price_drop', base || jsonb_build_object('dropPercent', w.drop_percent), format('pd:%s:%s', w.id, new.id))
      on conflict (user_id, dedupe_key) do nothing;
    end if;

    if w.notify_restock and new.in_stock is true and prev.in_stock is not true
       and (w.restock_variant_values is null or info.attributes @> w.restock_variant_values) then
      insert into public.notification_queue (user_id, kind, payload, dedupe_key)
      values (w.user_id, 'restock', base, format('rs:%s:%s', w.id, new.id))
      on conflict (user_id, dedupe_key) do nothing;
    end if;
  end loop;
  return new;
end $$;

create trigger price_events_notify
  after insert on public.price_events
  for each row execute function public.enqueue_price_notifications();

-- ---------------------------------------------------------------------------
-- A new review on a watched product, and activity on my own review
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_review_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare info record;
begin
  if new.body is null or new.status <> 'visible' then
    return new;
  end if;
  select name, url into info from public.products where id = new.product_id;
  insert into public.notification_queue (user_id, kind, payload, dedupe_key)
  select w.user_id, 'new_review_on_watch',
         jsonb_build_object('reviewId', new.id, 'productId', new.product_id, 'name', info.name, 'url', info.url, 'rating', new.rating),
         format('nr:%s', new.id)
  from public.watches w
  where w.active and w.product_id = new.product_id and w.user_id <> new.user_id
  group by w.user_id
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end $$;

create trigger reviews_notify_watchers
  after insert on public.reviews
  for each row execute function public.enqueue_review_notifications();

create or replace function public.enqueue_helpful_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select r2.user_id, r2.product_id, p.name, p.url into r
    from public.reviews r2 join public.products p on p.id = r2.product_id where r2.id = new.review_id;
  if r.user_id is not null then
    insert into public.notification_queue (user_id, kind, payload, dedupe_key)
    values (r.user_id, 'my_review_activity',
            jsonb_build_object('reviewId', new.review_id, 'productId', r.product_id, 'name', r.name, 'url', r.url, 'activity', 'helpful'),
            format('hv:%s:%s', new.review_id, new.user_id))
    on conflict (user_id, dedupe_key) do nothing;
  end if;
  return new;
end $$;

create trigger helpful_votes_notify
  after insert on public.helpful_votes
  for each row execute function public.enqueue_helpful_notification();

revoke execute on function public.check_watch_target() from public, anon, authenticated;
revoke execute on function public.enqueue_price_notifications() from public, anon, authenticated;
revoke execute on function public.enqueue_review_notifications() from public, anon, authenticated;
revoke execute on function public.enqueue_helpful_notification() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reminders (spec 6 and 8). Run on a schedule, for example every hour.
-- ---------------------------------------------------------------------------

-- Waiting-for-review reminder: at most one per user per week, merged into a single message with the count.
-- Durability reminder: once, three months after delivery of a verified review that has no update yet.
create or replace function public.enqueue_reminders(p_now timestamptz default now())
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notification_queue (user_id, kind, payload, dedupe_key)
  select pr.user_id, 'pending_review_reminder', jsonb_build_object('count', count(*)),
         format('pr:%s:%s', pr.user_id, to_char(p_now, 'IYYY-IW'))
  from public.pending_reviews pr
  where not pr.dismissed and pr.due_at <= p_now
  group by pr.user_id
  on conflict (user_id, dedupe_key) do nothing;

  insert into public.notification_queue (user_id, kind, payload, dedupe_key)
  select r.user_id, 'durability_reminder',
         jsonb_build_object('reviewId', r.id, 'productId', r.product_id, 'name', p.name, 'url', p.url),
         format('dr:%s', r.id)
  from public.reviews r join public.products p on p.id = r.product_id
  where r.verification = 'verified' and r.status = 'visible' and r.body is not null
    and r.delivered_at is not null
    and r.delivered_at + coalesce((select (value ->> 'durability_after_days')::int from public.settings where key = 'notifications'), 90) <= p_now::date
    and not exists (select 1 from public.review_updates u where u.review_id = r.id)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

revoke execute on function public.enqueue_reminders(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Watches and the rest of tracking as the clients see them
-- ---------------------------------------------------------------------------

-- Clients read a watch together with its product. Both tables already have the needed policies and grants.
create index if not exists watches_product_active on public.watches (product_id) where active;
create index if not exists price_events_install_day on public.price_events (install_hash, observed_at desc) where install_hash is not null;

insert into public.settings (key, value) values
  ('price_reports', '{"per_install_per_day":200,"outlier_ratio":0.6,"confirmations":2,"window_hours":24,"history_days":90}'),
  ('moderation_limits', '{"reports_per_day":20,"updates_per_review":5}')
on conflict (key) do nothing;
