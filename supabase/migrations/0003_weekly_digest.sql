-- Weekly digest (spec 14, "סיכום שבועי", off by default). Only for people who turned it on, and only when something
-- changed: a digest that says "nothing happened" is exactly the noise the product promises not to make.

create or replace function public.enqueue_weekly_digest(p_now timestamptz default now())
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notification_queue (user_id, kind, payload, dedupe_key)
  select c.user_id, 'weekly_digest',
         jsonb_build_object('watching', max(c.watching), 'changes', jsonb_agg(jsonb_build_object('name', c.name, 'url', c.url, 'from', c.before_price, 'to', c.now_price) order by c.name)),
         format('wd:%s:%s', c.user_id, to_char(p_now, 'IYYY-IW'))
  from (
    select w.user_id, w.id as watch_id, p.name, p.url,
           count(*) over (partition by w.user_id) as watching,
           (select min(x.price) from (
              select distinct on (e.variant_id) e.price from public.price_events e
              join public.variants v2 on v2.id = e.variant_id
              where v2.product_id = w.product_id and (w.variant_id is null or v2.id = w.variant_id)
                and e.price is not null and e.observed_at <= p_now - interval '7 days'
              order by e.variant_id, e.id desc) x) as before_price,
           (select min(x.price) from (
              select distinct on (e.variant_id) e.price from public.price_events e
              join public.variants v2 on v2.id = e.variant_id
              where v2.product_id = w.product_id and (w.variant_id is null or v2.id = w.variant_id)
                and e.price is not null and e.observed_at <= p_now
              order by e.variant_id, e.id desc) x) as now_price
    from public.watches w
    join public.products p on p.id = w.product_id
    join public.notification_prefs np on np.user_id = w.user_id and np.kind = 'weekly_digest' and np.enabled
    where w.active
  ) c
  where c.before_price is not null and c.now_price is not null and c.before_price <> c.now_price
  group by c.user_id
  on conflict (user_id, dedupe_key) do nothing;
end $$;

revoke execute on function public.enqueue_weekly_digest(timestamptz) from public, anon, authenticated;
